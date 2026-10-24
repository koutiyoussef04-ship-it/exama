/**
 * One question, reviewed next to its source. Wide screens: the source passage (quote highlighted, page or
 * time, match score, verifier verdict, review flags) on the left and the editable question on the right;
 * narrow screens: the source first, then the question. A fixed action bar does approve / reject / save,
 * "approve and next" and previous/next within the queue the question was opened from (the list's
 * filters travel in the URL). Web keyboard shortcuts: A approve-and-next, R reject, N next, P previous.
 *
 * Saving content edits creates a new version and sends the item back to draft — the server enforces
 * this; the screen only explains it. Role checks here are cosmetic: a 403 is shown like any other error.
 */
import { marketProfile, type BankItemDetail, type BankItemEvent, type BankItemStatus, type SourcePassage } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { draftFromItem, draftToInput, ItemFields, validateDraft, type DraftProblem, type ItemDraft } from '@/components/org/item-form';
import { ChecksCell } from '@/components/org/question-table';
import { IconButton, OrgGate, queueParams, SmallButton, useIsWide, useKeyShortcuts, WorkspaceShell, type OrgContext, type QueueParams } from '@/components/org/workspace';
import { Badge, Body, Card, colors, ErrorState, ErrorText, Field, Loading, pct, SectionLabel, space } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { canEdit, flagHint, flagLabel, sourceLabel, STATUS_TONE, statusLabel, VERDICT_TONE, verdictLabel } from '@/lib/org';

type ReviewAction = 'approve' | 'reject' | 'retire' | 'reopen';
const QUEUE_LIMIT = 200;

export default function OrgItemScreen() {
  return <OrgGate>{(ctx) => <Item {...ctx} />}</OrgGate>;
}

/** The list this question was opened from, for previous / next. */
function useQueue(orgId: string, currentId: string, params: QueueParams) {
  const status = (['draft', 'approved', 'rejected', 'retired'] as const).find((s) => s === params.status) as BankItemStatus | undefined;
  const enabled = !!status;
  const filters = { status, documentId: params.documentId || undefined, q: params.q || undefined, attention: params.attention === 'flagged' || params.attention === 'clean' ? params.attention : undefined, sort: params.sort === 'oldest' ? ('oldest' as const) : undefined };
  const list = useQuery({
    queryKey: ['org', orgId, 'queue', filters],
    queryFn: () => api.orgItems(orgId, { ...filters, limit: QUEUE_LIMIT }),
    enabled,
    staleTime: 60_000,
  });
  return useMemo(() => {
    const ids = list.data?.items.map((i) => i.id) ?? [];
    const index = ids.indexOf(currentId);
    return {
      enabled,
      total: list.data?.total ?? 0,
      index,
      prevId: index > 0 ? ids[index - 1] : null,
      nextId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
      /** After the current item leaves the list (approved/rejected): the item that was after it, else the one before. */
      afterLeaving: index >= 0 ? (ids[index + 1] ?? ids[index - 1] ?? null) : null,
    };
  }, [list.data, currentId, enabled]);
}

function Item(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const { id, ...rest } = useLocalSearchParams<{ id: string; documentId?: string; q?: string; attention?: string; status?: string; sort?: string }>();
  const queueP: QueueParams = { documentId: rest.documentId, q: rest.q, attention: rest.attention, status: rest.status, sort: rest.sort };
  const qc = useQueryClient();
  const wide = useIsWide();
  const profile = marketProfile(org.market);
  const key = ['org', org.id, 'item', id];

  const item = useQuery({ queryKey: key, queryFn: () => api.orgItem(org.id, id) });
  const queue = useQueue(org.id, id, queueP);

  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [endOfQueue, setEndOfQueue] = useState(false);
  useEffect(() => {
    if (item.data && !dirty) setDraft(draftFromItem(item.data));
  }, [item.data, dirty]);
  // A new question: fresh form state.
  useEffect(() => {
    setDirty(false);
    setSaved(false);
    setNote('');
    setProblem(null);
    setEndOfQueue(false);
  }, [id]);

  const goTo = (nextId: string) => router.replace({ pathname: '/org/items/[id]', params: { id: nextId, orgId: org.id, ...queueParams(queueP) } });
  const backToQueue = () => {
    const status = queueP.status === 'approved' ? '/org/bank' : '/org/review';
    router.replace({ pathname: status, params: { orgId: org.id, ...queueParams({ documentId: queueP.documentId, q: queueP.q, attention: queueP.attention }) } });
  };

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
    mutationFn: ({ action, andNext }: { action: ReviewAction; andNext: boolean }) => api.orgReviewItem(org.id, id, action, note.trim() || undefined).then((r) => ({ r, andNext })),
    onSuccess: ({ r, andNext }) => {
      applyResult(r);
      if (andNext) {
        const next = queue.afterLeaving;
        if (next) goTo(next);
        else setEndOfQueue(true);
      }
    },
  });
  /** Edited and approved in one go: save first (new version, back to draft), then approve that version. */
  const saveAndApprove = useMutation({
    mutationFn: async (d: ItemDraft) => {
      await api.orgUpdateItem(org.id, id, draftToInput(d, item.data!.type, profile.legalMetadata));
      return api.orgReviewItem(org.id, id, 'approve', note.trim() || undefined);
    },
    onSuccess: (updated) => {
      applyResult(updated);
      const next = queue.afterLeaving;
      if (next) goTo(next);
      else setEndOfQueue(true);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.orgDeleteItem(org.id, id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['org', org.id] });
      backToQueue();
    },
  });

  const validDraft = () => {
    if (!draft || !item.data) return null;
    const bad = validateDraft(draft, item.data.type, profile.legalMetadata);
    setProblem(bad);
    return bad ? null : draft;
  };
  const onSave = () => {
    const d = validDraft();
    if (d) save.mutate(d);
  };
  const onApproveNext = () => {
    if (!item.data || item.data.status !== 'draft' || busy) return;
    if (dirty) {
      const d = validDraft();
      if (d) saveAndApprove.mutate(d);
    } else review.mutate({ action: 'approve', andNext: true });
  };
  const askDelete = async () => {
    if (await confirm({ title: t('org.item.deleteTitle'), message: t('org.item.deleteMessage'), confirmText: t('common.delete'), destructive: true })) remove.mutate();
  };

  const it = item.data;
  const busy = save.isPending || review.isPending || saveAndApprove.isPending || remove.isPending;
  useKeyShortcuts(
    {
      a: it?.status === 'draft' ? onApproveNext : undefined,
      r: it?.status === 'draft' && !dirty ? () => review.mutate({ action: 'reject', andNext: true }) : undefined,
      n: queue.nextId ? () => goTo(queue.nextId!) : undefined,
      p: queue.prevId ? () => goTo(queue.prevId!) : undefined,
    },
    !!it && !busy,
  );

  if (item.isLoading && !it) return <Loading />;
  if (!it || !draft) {
    return (
      <WorkspaceShell {...ctx} active="review" title={t('org.ws.review.questionPanel')} back={{ label: t('org.ws.item.back'), onPress: backToQueue }}>
        <ErrorState error={item.error} onRetry={() => item.refetch()} />
      </WorkspaceShell>
    );
  }
  const retired = it.status === 'retired';
  const actionError = save.error ?? review.error ?? saveAndApprove.error ?? remove.error;
  const section = it.status === 'approved' ? 'bank' : 'review';

  const sourcePane = (
    <View style={{ gap: space(3), flex: wide ? 5 : undefined }}>
      <SectionLabel>{t('org.ws.review.sourcePanel')}</SectionLabel>
      <Card style={{ gap: space(3) }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{it.documentTitle}</Text>
        {it.sources.length === 0 && <Body muted style={{ fontSize: 14 }}>{t('org.ws.review.noSourceHint')}</Body>}
        {it.sources.map((s) => (
          <SourceBlock key={s.id} source={s} passage={it.passages.find((p) => p.sourceId === s.id) ?? null} compact={!wide} />
        ))}
      </Card>
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('org.ws.review.checks')}</SectionLabel>
        <ChecksCell item={it} />
        {it.verification ? (
          <View style={{ gap: space(1) }}>
            <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
              <Badge label={verdictLabel(it.verification.verdict)} tone={VERDICT_TONE[it.verification.verdict]} />
              <Text style={{ color: colors.muted, fontSize: 12 }}>{t('org.item.verification')}</Text>
            </View>
            {/* "Not checked" notes are fixed English sentences from the server: show them in the interface language. */}
            {it.verification.verdict === 'unavailable' ? (
              <Body muted style={{ fontSize: 14 }}>{t('org.item.verificationUnavailable')}</Body>
            ) : (
              !!it.verification.note && <Body muted style={{ fontSize: 14 }}>{it.verification.note}</Body>
            )}
          </View>
        ) : (
          <Body muted style={{ fontSize: 14 }}>{t('org.item.noVerification')}</Body>
        )}
        {it.reviewFlags.map((f) => (
          <View key={f} style={{ gap: 2 }}>
            <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '700' }}>{flagLabel(f)}</Text>
            <Body muted style={{ fontSize: 13 }}>{flagHint(f)}</Body>
          </View>
        ))}
      </Card>
      <Card style={{ gap: 0 }}>
        <SectionLabel>{t('org.item.history')}</SectionLabel>
        {it.events.map((e, i) => (
          <EventRow key={e.id} event={e} last={i === it.events.length - 1} />
        ))}
      </Card>
    </View>
  );

  const questionPane = (
    <View style={{ gap: space(3), flex: wide ? 6 : undefined }}>
      <SectionLabel>{t('org.ws.review.questionPanel')}</SectionLabel>
      <Card style={{ gap: space(4) }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>
          <Badge label={statusLabel(it.status)} tone={STATUS_TONE[it.status]} />
          <Badge label={t(`org.type.${it.type}`)} />
          <Badge label={t(`org.item.origin.${it.origin}`)} />
          <Badge label={t('org.item.version', { version: it.version })} />
        </View>
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
        {problem && <Body style={{ color: colors.danger, fontSize: 14 }}>{t(problem)}</Body>}
        {!retired && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), alignItems: 'center' }}>
            <SmallButton title={t('org.item.save')} onPress={onSave} loading={save.isPending} disabled={!dirty || busy} />
            {dirty && (
              <SmallButton
                title={t('org.item.discard')}
                variant="ghost"
                onPress={() => {
                  setDraft(draftFromItem(it));
                  setDirty(false);
                  setProblem(null);
                }}
                disabled={busy}
              />
            )}
            {saved && !dirty && <Text style={{ color: colors.success, fontSize: 13 }}>{t('org.item.saved')}</Text>}
            {dirty && <Text style={{ color: colors.muted, fontSize: 13 }}>{t('org.item.saveHint')}</Text>}
          </View>
        )}
      </Card>
      {(it.status === 'draft' || it.status === 'approved') && (
        <Card style={{ gap: space(2) }}>
          <Field label={t('org.item.note')} value={note} onChangeText={setNote} placeholder={t('org.item.notePlaceholder')} multiline maxLength={1000} />
          {!!it.reviewNote && (
            <Body muted style={{ fontSize: 13 }}>
              {t('org.item.lastNote')}: {it.reviewNote}
            </Body>
          )}
        </Card>
      )}
      {canEdit(org.role) && <SmallButton title={t('org.item.delete')} variant="ghost" onPress={askDelete} disabled={busy} style={{ alignSelf: 'flex-start' }} />}
    </View>
  );

  const footer = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) }}>
      {queue.enabled && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
          <IconButton icon="chevronLeft" label={t('org.ws.review.previous')} onPress={() => queue.prevId && goTo(queue.prevId)} disabled={!queue.prevId || busy} />
          <Text style={{ color: colors.muted, fontSize: 13, minWidth: 64, textAlign: 'center' }}>{queue.index >= 0 ? t('org.ws.review.queuePosition', { index: queue.index + 1, total: queue.total }) : ''}</Text>
          <IconButton icon="chevronRight" label={t('org.ws.review.next')} onPress={() => queue.nextId && goTo(queue.nextId)} disabled={!queue.nextId || busy} />
        </View>
      )}
      <View style={{ flex: 1 }} />
      {endOfQueue && <Text style={{ color: colors.success, fontSize: 13 }}>{t('org.ws.review.endOfQueue')}</Text>}
      <ErrorText error={actionError} />
      {it.status === 'draft' && (
        <>
          <SmallButton title={t('org.item.reject')} variant="danger" shortcut="R" onPress={() => review.mutate({ action: 'reject', andNext: true })} loading={review.isPending && review.variables?.action === 'reject'} disabled={busy || dirty} />
          <SmallButton title={t('org.item.approve')} onPress={() => review.mutate({ action: 'approve', andNext: false })} loading={review.isPending && review.variables?.action === 'approve' && !review.variables.andNext} disabled={busy || dirty} />
          <SmallButton title={dirty ? t('org.ws.review.saveAndApprove') : t('org.ws.review.approveNext')} variant="primary" icon="check" shortcut="A" onPress={onApproveNext} loading={saveAndApprove.isPending || (review.isPending && review.variables?.action === 'approve' && !!review.variables.andNext)} disabled={busy} />
        </>
      )}
      {it.status === 'approved' && <SmallButton title={t('org.item.retire')} onPress={() => review.mutate({ action: 'retire', andNext: false })} loading={review.isPending} disabled={busy} />}
      {(it.status === 'rejected' || it.status === 'retired') && <SmallButton title={t('org.item.reopen')} variant="primary" onPress={() => review.mutate({ action: 'reopen', andNext: false })} loading={review.isPending} disabled={busy} />}
    </View>
  );

  return (
    <WorkspaceShell {...ctx} active={section} title={it.stem} subtitle={[it.topic, it.section].filter(Boolean).join(' · ')} back={{ label: queueP.status === 'approved' ? t('org.ws.bank.title') : t('org.ws.review.backToQueue'), onPress: backToQueue }} footer={footer} onRefresh={() => item.refetch()} refreshing={item.isRefetching}>
      {wide && <Text style={{ color: colors.muted, fontSize: 12 }}>{t('org.ws.review.shortcuts')}</Text>}
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space(5), alignItems: 'flex-start' }}>
        {sourcePane}
        {questionPane}
      </View>
    </WorkspaceShell>
  );
}

/** One source: location, match score, and the passage with the quote highlighted (or the quote alone). */
/** Small screens show this much text either side of the quote until the passage is expanded. */
const COMPACT_CONTEXT = 220;

function SourceBlock({ source: s, passage, compact }: { source: BankItemDetail['sources'][number]; passage: SourcePassage | null; compact: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const parts = useMemo(() => {
    if (!passage) return null;
    const { text } = passage;
    if (passage.quoteStart == null || passage.quoteEnd == null) {
      const trimmed = compact && !expanded && text.length > COMPACT_CONTEXT * 2;
      return { parts: [{ text: trimmed ? `${text.slice(0, COMPACT_CONTEXT * 2)}…` : text, mark: false }], trimmed };
    }
    let from = 0;
    let to = text.length;
    const trimmed = compact && !expanded && (passage.quoteStart > COMPACT_CONTEXT || text.length - passage.quoteEnd > COMPACT_CONTEXT);
    if (trimmed) {
      from = Math.max(0, passage.quoteStart - COMPACT_CONTEXT);
      to = Math.min(text.length, passage.quoteEnd + COMPACT_CONTEXT);
    }
    return {
      trimmed,
      parts: [
        { text: (from > 0 ? '…' : '') + text.slice(from, passage.quoteStart), mark: false },
        { text: text.slice(passage.quoteStart, passage.quoteEnd), mark: true },
        { text: text.slice(passage.quoteEnd, to) + (to < text.length ? '…' : ''), mark: false },
      ].filter((p) => p.text.length > 0),
    };
  }, [passage, compact, expanded]);
  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), alignItems: 'center' }}>
        <Badge label={sourceLabel(s)} tone={s.located ? 'primary' : 'danger'} />
        <Badge label={t('org.source.match', { pct: pct(s.matchScore) })} tone={s.matchScore >= 0.95 ? 'success' : 'warning'} />
      </View>
      {parts ? (
        <View style={{ backgroundColor: colors.bg, borderRadius: 10, padding: space(3), borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 22 }}>
            {parts.parts.map((p, i) => (
              <Text key={i} style={p.mark ? { backgroundColor: '#FFF2B3', color: colors.navy, fontWeight: '600' } : undefined}>
                {p.text}
              </Text>
            ))}
          </Text>
          {(parts.trimmed || expanded) && (
            <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8} accessibilityRole="button" style={{ marginTop: space(2) }}>
              <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>{expanded ? t('course.showLess') : t('course.readMore')}</Text>
            </Pressable>
          )}
          {passage && passage.quoteStart == null && (
            <View style={{ marginTop: space(2), gap: 2 }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{t('org.ws.review.quotedPassage')}</Text>
              <Text style={{ color: colors.navy, fontSize: 14, lineHeight: 21, fontStyle: 'italic' }}>“{s.quote}”</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={{ gap: space(1.5) }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 21, fontStyle: 'italic' }}>“{s.quote}”</Text>
          {s.located ? <Body muted style={{ fontSize: 13 }}>{t('org.ws.review.passageMissing')}</Body> : <Body style={{ color: colors.danger, fontSize: 13 }}>{t('org.source.notConfirmedHint')}</Body>}
        </View>
      )}
    </View>
  );
}

function EventRow({ event: e, last }: { event: BankItemEvent; last: boolean }) {
  const { t } = useTranslation();
  const when = new Date(e.createdAt);
  const time = Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={{ gap: 2, paddingVertical: space(2), borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{t(`org.item.events.${e.action}`)}</Text>
        <Badge label={t('org.item.version', { version: e.version })} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{[e.actorName ?? t('org.item.system'), `${formatDate(e.createdAt)} ${time}`.trim()].join(' · ')}</Text>
      {!!e.note && <Text style={{ color: colors.text, fontSize: 13 }}>{e.note}</Text>}
    </View>
  );
}
