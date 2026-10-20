/**
 * One organization course: processing status, summary and topics, the "generate draft questions" form
 * (editors) and the questions already written from it. Drafts are never approved here — they go to the
 * review queue.
 */
import { marketProfile, MAX_ITEMS_PER_GENERATION, type GenerateBankItemsResult } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { ItemRow } from '@/components/org/item-form';
import { OrgGate, OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Chips } from '@/components/planner';
import { Badge, Body, Button, Card, colors, ContentDirection, ErrorState, ErrorText, Field, Loading, Screen, SectionLabel, space, TextButton, WorkingCard } from '@/components/ui';
import { api } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { documentErrorMessage, isRetryableDocumentError } from '@/lib/errors';
import { canEdit } from '@/lib/org';
import { usePreferences } from '@/lib/preferences';

export default function OrgCourseScreen() {
  return <OrgGate>{(ctx) => <Course {...ctx} />}</OrgGate>;
}

function Course(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const editor = canEdit(org.role);

  const course = useQuery({
    queryKey: ['org', org.id, 'course', id],
    queryFn: () => api.orgCourse(org.id, id),
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  });
  const items = useQuery({
    queryKey: ['org', org.id, 'items', { documentId: id }],
    queryFn: () => api.orgItems(org.id, { documentId: id, limit: 200 }),
    enabled: course.data?.status === 'ready',
  });

  const retry = useMutation({
    mutationFn: () => api.orgReprocessCourse(org.id, id),
    onSuccess: (updated) => {
      qc.setQueryData(['org', org.id, 'course', id], updated);
      void qc.invalidateQueries({ queryKey: ['org', org.id, 'courses'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.orgDeleteCourse(org.id, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org', org.id] });
      router.replace({ pathname: '/org/courses', params: { orgId: org.id } });
    },
  });
  const askDelete = async () => {
    if (await confirm({ title: t('org.course.deleteTitle'), message: t('org.course.deleteMessage'), confirmText: t('common.delete'), destructive: true })) remove.mutate();
  };

  if (course.isLoading) return <Loading />;
  if (!course.data) {
    return (
      <Screen>
        <OrgNav {...ctx} active="courses" />
        <ErrorState error={course.error} onRetry={() => course.refetch()} />
      </Screen>
    );
  }
  const d = course.data;
  const retryable = isRetryableDocumentError(d.errorCode);

  return (
    <Screen onRefresh={() => course.refetch()} refreshing={course.isRefetching}>
      <Stack.Screen options={{ title: d.title }} />
      <OrgNav {...ctx} active="courses" />
      <View style={{ gap: space(1) }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }} accessibilityRole="header">
          {d.title}
        </Text>
        <Body muted style={{ fontSize: 13 }}>
          {[d.pageCount != null ? t(d.format === 'pptx' ? 'org.courses.slides' : 'org.courses.pages', { count: d.pageCount }) : null, t(`org.courses.status.${d.status}`)].filter(Boolean).join(' · ')}
        </Body>
      </View>

      {d.status === 'processing' && <WorkingCard title={t('org.course.readingTitle')} detail={t('org.course.readingDetail')} />}

      {d.status === 'failed' && (
        <Card style={{ gap: space(3) }}>
          <Badge label={t('org.courses.status.failed')} tone="danger" />
          <Body muted>{documentErrorMessage(d.errorCode, d.error)}</Body>
          {retryable && editor && <Button variant="secondary" title={t('common.tryAgain')} onPress={() => retry.mutate()} loading={retry.isPending} />}
          <ErrorText error={retry.error} />
        </Card>
      )}

      {d.status === 'ready' && (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('org.course.summary')}</SectionLabel>
          {!!d.summary && (
            <>
              <ContentDirection language={d.summaryLanguage}>
                <Body numberOfLines={summaryOpen ? undefined : 4}>{d.summary}</Body>
              </ContentDirection>
              {d.summary.length > 220 && (
                <Pressable onPress={() => setSummaryOpen((o) => !o)} hitSlop={8} accessibilityRole="button">
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>{summaryOpen ? t('course.showLess') : t('course.readMore')}</Text>
                </Pressable>
              )}
            </>
          )}
          <SectionLabel>{t('org.course.topics')}</SectionLabel>
          <ContentDirection language={d.summaryLanguage} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {d.topics.map((x) => (
              <Badge key={x} label={x} tone="primary" />
            ))}
          </ContentDirection>
        </Card>
      )}

      {d.status === 'ready' &&
        (editor ? (
          <GenerateCard ctx={ctx} courseId={id} topics={d.topics} pageCount={d.pageCount} />
        ) : (
          <Body muted style={{ fontSize: 14 }}>{t('org.course.generate.editorsOnly')}</Body>
        ))}

      {d.status === 'ready' && (
        <Card style={{ gap: 0 }}>
          <SectionLabel>{t('org.course.items')}</SectionLabel>
          {items.isLoading && <Loading />}
          {items.error && <ErrorText error={items.error} />}
          {items.data && items.data.items.length === 0 && <Body muted style={{ paddingVertical: space(3) }}>{t('org.course.noItems')}</Body>}
          {items.data?.items.map((it, i) => (
            <ItemRow key={it.id} item={it} showCourse={false} last={i === items.data.items.length - 1} onPress={() => router.push({ pathname: '/org/items/[id]', params: { id: it.id, orgId: org.id } })} />
          ))}
        </Card>
      )}

      {editor && (
        <>
          <TextButton title={remove.isPending ? t('course.deleting') : t('org.course.delete')} tone="danger" onPress={askDelete} disabled={remove.isPending} />
          <ErrorText error={remove.error} />
        </>
      )}
    </Screen>
  );
}

function GenerateCard({ ctx, courseId, topics, pageCount }: { ctx: OrgContext; courseId: string; topics: string[]; pageCount: number | null }) {
  const { t } = useTranslation();
  const { org } = ctx;
  const qc = useQueryClient();
  const { aiLanguage } = usePreferences();
  const profile = marketProfile(org.market);
  const [count, setCount] = useState('10');
  const [topic, setTopic] = useState<string>('');
  const [pageStart, setPageStart] = useState('');
  const [pageEnd, setPageEnd] = useState('');
  const [types, setTypes] = useState<'mcq' | 'mixed'>(profile.mcqOnly ? 'mcq' : 'mixed');
  const [result, setResult] = useState<GenerateBankItemsResult | null>(null);

  const n = Number.parseInt(count, 10);
  const start = pageStart.trim() ? Number.parseInt(pageStart, 10) : undefined;
  const end = pageEnd.trim() ? Number.parseInt(pageEnd, 10) : undefined;
  const countOk = Number.isInteger(n) && n >= 1 && n <= MAX_ITEMS_PER_GENERATION;
  const pagesOk = (start === undefined || (Number.isInteger(start) && start >= 1)) && (end === undefined || (Number.isInteger(end) && end >= 1)) && (start === undefined || end === undefined || end >= start);

  const generate = useMutation({
    mutationFn: () => api.orgGenerate(org.id, courseId, { count: n, topic: topic || undefined, pageStart: start, pageEnd: end, questionTypes: types, language: aiLanguage }),
    onSuccess: (res) => {
      setResult(res);
      void qc.invalidateQueries({ queryKey: ['org', org.id] });
    },
  });

  return (
    <Card style={{ gap: space(4) }}>
      <View style={{ gap: space(1) }}>
        <SectionLabel>{t('org.course.generate.title')}</SectionLabel>
        <Body muted style={{ fontSize: 14 }}>{t('org.course.generate.intro')}</Body>
      </View>
      {generate.isPending ? (
        <WorkingCard title={t('org.course.generate.working')} detail={t('org.course.generate.workingDetail')} />
      ) : (
        <>
          <Field label={t('org.course.generate.count', { max: MAX_ITEMS_PER_GENERATION })} value={count} onChangeText={setCount} keyboardType="number-pad" inputMode="numeric" maxLength={2} />
          {topics.length > 0 && (
            <View style={{ gap: space(2) }}>
              <SectionLabel>{t('org.course.generate.topic')}</SectionLabel>
              <Chips options={[{ value: '', label: t('org.course.generate.allTopics') }, ...topics.map((x) => ({ value: x, label: x }))]} value={topic} onChange={setTopic} />
            </View>
          )}
          <View style={{ gap: space(2) }}>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Field label={t('org.course.generate.pageStart')} value={pageStart} onChangeText={setPageStart} keyboardType="number-pad" inputMode="numeric" placeholder="1" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t('org.course.generate.pageEnd')} value={pageEnd} onChangeText={setPageEnd} keyboardType="number-pad" inputMode="numeric" placeholder={pageCount != null ? String(pageCount) : ''} />
              </View>
            </View>
            <Body muted style={{ fontSize: 13 }}>{t('org.course.generate.pagesHint')}</Body>
          </View>
          <View style={{ gap: space(2) }}>
            <SectionLabel>{t('org.course.generate.types')}</SectionLabel>
            <Chips<'mcq' | 'mixed'>
              options={[
                { value: 'mcq', label: t('org.course.generate.mcq') },
                { value: 'mixed', label: t('org.course.generate.mixed') },
              ]}
              value={types}
              onChange={setTypes}
            />
            {profile.mcqOnly && <Body muted style={{ fontSize: 13 }}>{t('org.course.generate.mcqDefault')}</Body>}
          </View>
          {!pagesOk && <Body style={{ color: colors.danger, fontSize: 14 }}>{t('org.course.generate.badPages')}</Body>}
          <Button title={t('org.course.generate.button')} onPress={() => generate.mutate()} disabled={!countOk || !pagesOk} />
        </>
      )}
      {result && (
        <View style={{ backgroundColor: colors.successSoft, borderRadius: 12, padding: space(3), gap: space(1) }}>
          <Body style={{ fontWeight: '600' }}>{t('org.course.generate.result', { added: result.items.length, discarded: result.discarded })}</Body>
          <Body muted style={{ fontSize: 13 }}>{t('org.course.generate.resultHint')}</Body>
          <TextButton title={t('org.dashboard.reviewDrafts')} onPress={() => router.push({ pathname: '/org/review', params: { orgId: org.id, documentId: courseId } })} />
        </View>
      )}
      <ErrorText error={generate.error} />
    </Card>
  );
}
