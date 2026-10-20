/**
 * One question of the bank: edit its content, read its source quote(s) and verification, and review it
 * (approve / reject / retire / reopen). Saving content edits creates a new version and sends the item
 * back to draft — the server enforces this; the screen only explains it. Role checks here are cosmetic:
 * a 403 from the server is shown like any other error.
 */
import { marketProfile, type BankItemDetail, type BankItemEvent } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { draftFromItem, draftToInput, ItemFields, validateDraft, type DraftProblem, type ItemDraft } from '@/components/org/item-form';
import { OrgGate, OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Badge, Body, Button, Card, colors, ErrorState, ErrorText, Field, Loading, pct, Screen, SectionLabel, space, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { canEdit, flagHint, flagLabel, sourceLabel, STATUS_TONE, statusLabel, VERDICT_TONE, verdictLabel } from '@/lib/org';

type ReviewAction = 'approve' | 'reject' | 'retire' | 'reopen';

export default function OrgItemScreen() {
  return <OrgGate>{(ctx) => <Item {...ctx} />}</OrgGate>;
}

function Item(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const profile = marketProfile(org.market);
  const key = ['org', org.id, 'item', id];

  const item = useQuery({ queryKey: key, queryFn: () => api.orgItem(org.id, id) });

  // Editable copy of the item; reset whenever a fresh version arrives and nothing is being edited.
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  useEffect(() => {
    if (item.data && !dirty) setDraft(draftFromItem(item.data));
  }, [item.data, dirty]);

  const applyResult = (updated: BankItemDetail) => {
    qc.setQueryData(key, updated);
    void qc.invalidateQueries({ queryKey: ['org', org.id, 'items'] });
    void qc.invalidateQueries({ queryKey: ['org', org.id, 'topics'] });
    void qc.invalidateQueries({ queryKey: ['org', org.id, 'overview'] });
    setDirty(false);
    setNote('');
  };

  const save = useMutation({
    mutationFn: (d: ItemDraft) => api.orgUpdateItem(org.id, id, draftToInput(d, item.data!.type, profile.legalMetadata)),
    onSuccess: (updated) => {
      applyResult(updated);
      setSaved(true);
    },
  });
  const review = useMutation({
    mutationFn: (action: ReviewAction) => api.orgReviewItem(org.id, id, action, note.trim() || undefined),
    onSuccess: applyResult,
  });
  const remove = useMutation({
    mutationFn: () => api.orgDeleteItem(org.id, id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['org', org.id] });
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/org/review', params: { orgId: org.id } });
    },
  });

  const onSave = () => {
    if (!draft || !item.data) return;
    const bad = validateDraft(draft, item.data.type, profile.legalMetadata);
    setProblem(bad);
    if (!bad) save.mutate(draft);
  };
  const askDelete = async () => {
    if (await confirm({ title: t('org.item.deleteTitle'), message: t('org.item.deleteMessage'), confirmText: t('common.delete'), destructive: true })) remove.mutate();
  };

  if (item.isLoading) return <Loading />;
  if (!item.data || !draft) {
    return (
      <Screen>
        <OrgNav {...ctx} active="review" />
        <ErrorState error={item.error} onRetry={() => item.refetch()} />
      </Screen>
    );
  }
  const it = item.data;
  const retired = it.status === 'retired';
  const busy = save.isPending || review.isPending || remove.isPending;
  const actionError = save.error ?? review.error ?? remove.error;

  return (
    <Screen onRefresh={() => item.refetch()} refreshing={item.isRefetching}>
      <OrgNav {...ctx} active={it.status === 'approved' ? 'bank' : 'review'} />

      <View style={{ gap: space(2) }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>
          <Badge label={statusLabel(it.status)} tone={STATUS_TONE[it.status]} />
          <Badge label={t(`org.type.${it.type}`)} />
          <Badge label={t(`org.item.origin.${it.origin}`)} />
          <Badge label={t('org.item.version', { version: it.version })} />
        </View>
        <Body muted style={{ fontSize: 13 }}>
          {t('org.item.course')}: {it.documentTitle}
        </Body>
      </View>

      {/* Content */}
      <Card style={{ gap: space(4) }}>
        <SectionLabel>{t('org.item.content')}</SectionLabel>
        {retired && <Body muted style={{ fontSize: 14 }}>{t('org.item.retiredNoEdit')}</Body>}
        <ItemFields
          draft={draft}
          type={it.type}
          market={org.market}
          disabled={retired || busy}
          onChange={(next) => {
            setDraft(next);
            setDirty(true);
            setSaved(false);
            setProblem(null);
          }}
        />
        {!retired && (
          <View style={{ gap: space(2) }}>
            <Body muted style={{ fontSize: 13 }}>{t('org.item.saveHint')}</Body>
            {problem && <Body style={{ color: colors.danger, fontSize: 14 }}>{t(problem)}</Body>}
            <Button title={t('org.item.save')} onPress={onSave} loading={save.isPending} disabled={!dirty || busy} />
            {saved && !dirty && <Body style={{ color: colors.success, fontSize: 14, textAlign: 'center' }}>{t('org.item.saved')}</Body>}
            {dirty && (
              <TextButton
                title={t('org.item.discard')}
                tone="muted"
                onPress={() => {
                  setDraft(draftFromItem(it));
                  setDirty(false);
                  setProblem(null);
                }}
              />
            )}
          </View>
        )}
      </Card>

      {/* Sources */}
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('org.source.title')}</SectionLabel>
        {it.sources.length === 0 && <Body muted style={{ fontSize: 14 }}>{t('org.source.none')}</Body>}
        {it.sources.map((s) => (
          <View key={s.id} style={{ gap: space(1.5), backgroundColor: colors.bg, borderRadius: 12, padding: space(3) }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14, flexShrink: 1 }}>{it.documentTitle}</Text>
              <Badge label={sourceLabel(s)} tone={s.located ? 'neutral' : 'danger'} />
              <Badge label={t('org.source.match', { pct: pct(s.matchScore) })} tone={s.matchScore >= 0.95 ? 'success' : 'warning'} />
            </View>
            <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, fontStyle: 'italic' }}>“{s.quote}”</Text>
            {!s.located && <Body style={{ color: colors.danger, fontSize: 13 }}>{t('org.source.notConfirmedHint')}</Body>}
          </View>
        ))}
      </Card>

      {/* Verification + flags */}
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('org.item.verification')}</SectionLabel>
        {it.verification ? (
          <View style={{ gap: space(1.5) }}>
            <Badge label={verdictLabel(it.verification.verdict)} tone={VERDICT_TONE[it.verification.verdict]} />
            {!!it.verification.note && <Body muted style={{ fontSize: 14 }}>{it.verification.note}</Body>}
          </View>
        ) : (
          <Body muted style={{ fontSize: 14 }}>{t('org.item.noVerification')}</Body>
        )}
        <SectionLabel>{t('org.item.flagsTitle')}</SectionLabel>
        {it.reviewFlags.length === 0 && <Body muted style={{ fontSize: 14 }}>{t('org.item.noFlags')}</Body>}
        {it.reviewFlags.map((f) => (
          <View key={f} style={{ gap: space(1) }}>
            <Badge label={flagLabel(f)} tone="warning" />
            <Body muted style={{ fontSize: 13 }}>{flagHint(f)}</Body>
          </View>
        ))}
      </Card>

      {/* Review actions */}
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('org.item.actions')}</SectionLabel>
        {it.status === 'draft' && (
          <>
            <Body muted style={{ fontSize: 14 }}>{t('org.item.approveHint')}</Body>
            <Field label={t('org.item.note')} value={note} onChangeText={setNote} placeholder={t('org.item.notePlaceholder')} multiline maxLength={1000} />
            <Button title={t('org.item.approve')} onPress={() => review.mutate('approve')} loading={review.isPending && review.variables === 'approve'} disabled={busy || dirty} />
            <Button variant="danger" title={t('org.item.reject')} onPress={() => review.mutate('reject')} loading={review.isPending && review.variables === 'reject'} disabled={busy || dirty} />
            {dirty && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('org.item.saveFirst')}</Body>}
          </>
        )}
        {it.status === 'approved' && (
          <>
            <Body muted style={{ fontSize: 14 }}>{t('org.item.retireHint')}</Body>
            <Field label={t('org.item.note')} value={note} onChangeText={setNote} placeholder={t('org.item.notePlaceholder')} multiline maxLength={1000} />
            <Button variant="secondary" title={t('org.item.retire')} onPress={() => review.mutate('retire')} loading={review.isPending} disabled={busy} />
          </>
        )}
        {(it.status === 'rejected' || it.status === 'retired') && (
          <>
            <Body muted style={{ fontSize: 14 }}>{t('org.item.reopenHint')}</Body>
            <Button variant="secondary" title={t('org.item.reopen')} onPress={() => review.mutate('reopen')} loading={review.isPending} disabled={busy} />
          </>
        )}
        {!!it.reviewNote && (
          <Body muted style={{ fontSize: 13 }}>
            {t('org.item.lastNote')}: {it.reviewNote}
          </Body>
        )}
        <ErrorText error={actionError} />
      </Card>

      {/* History */}
      <Card style={{ gap: 0 }}>
        <SectionLabel>{t('org.item.history')}</SectionLabel>
        {it.events.map((e, i) => (
          <EventRow key={e.id} event={e} last={i === it.events.length - 1} />
        ))}
      </Card>

      {canEdit(org.role) && <TextButton title={t('org.item.delete')} tone="danger" onPress={askDelete} disabled={busy} />}
    </Screen>
  );
}

function EventRow({ event: e, last }: { event: BankItemEvent; last: boolean }) {
  const { t } = useTranslation();
  const when = new Date(e.createdAt);
  const time = Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={{ gap: 2, paddingVertical: space(2.5), borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{t(`org.item.events.${e.action}`)}</Text>
        <Badge label={t('org.item.version', { version: e.version })} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        {[e.actorName ?? t('org.item.system'), `${formatDate(e.createdAt)} ${time}`.trim()].join(' · ')}
      </Text>
      {!!e.note && <Text style={{ color: colors.text, fontSize: 14 }}>{e.note}</Text>}
    </View>
  );
}
