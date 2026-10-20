/**
 * One organization course: processing status, summary and topics, the "generate draft questions" form
 * (editors) and the questions already written from it. Drafts are never approved here — they go to the
 * review queue. Wide screens: summary + generation on the left, the questions table on the right.
 */
import { marketProfile, MAX_ITEMS_PER_GENERATION, type GenerateBankItemsResult } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { QuestionTable } from '@/components/org/question-table';
import { OrgGate, SmallButton, useIsWide, WorkspaceShell, type OrgContext } from '@/components/org/workspace';
import { Chips } from '@/components/planner';
import { Badge, Body, Card, colors, ContentDirection, ErrorState, ErrorText, Field, Loading, SectionLabel, space, WorkingCard } from '@/components/ui';
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
  const wide = useIsWide();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const editor = canEdit(org.role);

  const course = useQuery({
    queryKey: ['org', org.id, 'course', id],
    queryFn: () => api.orgCourse(org.id, id),
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  });
  const items = useQuery({
    queryKey: ['org', org.id, 'items', { documentId: id, limit: 200, offset: 0 }],
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
  const back = { label: t('org.ws.course.back'), onPress: () => router.replace({ pathname: '/org/courses', params: { orgId: org.id } }) };

  if (course.isLoading) return <Loading />;
  if (!course.data) {
    return (
      <WorkspaceShell {...ctx} active="courses" title={t('org.ws.courses.title')} back={back}>
        <ErrorState error={course.error} onRetry={() => course.refetch()} />
      </WorkspaceShell>
    );
  }
  const d = course.data;
  const retryable = isRetryableDocumentError(d.errorCode);
  const meta = [d.pageCount != null ? t(d.format === 'pptx' ? 'org.courses.slides' : 'org.courses.pages', { count: d.pageCount }) : null, t(`org.courses.status.${d.status}`)].filter(Boolean).join(' · ');

  const summary = (
    <View style={{ gap: space(3), flex: wide ? 1 : undefined }}>
      {d.status === 'processing' && <WorkingCard title={t('org.course.readingTitle')} detail={t('org.course.readingDetail')} />}
      {d.status === 'failed' && (
        <Card style={{ gap: space(3) }}>
          <Badge label={t('org.courses.status.failed')} tone="danger" />
          <Body muted>{documentErrorMessage(d.errorCode, d.error)}</Body>
          {retryable && editor && <SmallButton title={t('common.tryAgain')} onPress={() => retry.mutate()} loading={retry.isPending} />}
          <ErrorText error={retry.error} />
        </Card>
      )}
      {d.status === 'ready' && (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('org.course.summary')}</SectionLabel>
          {!!d.summary && (
            <>
              <ContentDirection language={d.summaryLanguage}>
                <Body style={{ fontSize: 14, lineHeight: 21 }} numberOfLines={summaryOpen ? undefined : 5}>
                  {d.summary}
                </Body>
              </ContentDirection>
              {d.summary.length > 280 && (
                <Pressable onPress={() => setSummaryOpen((o) => !o)} hitSlop={8} accessibilityRole="button">
                  <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>{summaryOpen ? t('course.showLess') : t('course.readMore')}</Text>
                </Pressable>
              )}
            </>
          )}
          <SectionLabel>{t('org.course.topics')}</SectionLabel>
          <ContentDirection language={d.summaryLanguage} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
            {d.topics.map((x) => (
              <Badge key={x} label={x} tone="primary" />
            ))}
          </ContentDirection>
        </Card>
      )}
      {editor && (
        <>
          <SmallButton title={remove.isPending ? t('course.deleting') : t('org.course.delete')} variant="ghost" onPress={askDelete} disabled={remove.isPending} style={{ alignSelf: 'flex-start' }} />
          <ErrorText error={remove.error} />
        </>
      )}
    </View>
  );
  const generation = d.status === 'ready' && (
    <View style={{ flex: wide ? 1 : undefined }}>{editor ? <GenerateCard ctx={ctx} courseId={id} topics={d.topics} pageCount={d.pageCount} /> : <Body muted style={{ fontSize: 14 }}>{t('org.course.generate.editorsOnly')}</Body>}</View>
  );

  const questions = d.status === 'ready' && (
    <View style={{ gap: space(2) }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{t('org.ws.course.questions')}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('org.ws.course.questionsHint')}</Text>
      </View>
      <QuestionTable orgId={org.id} items={items.data?.items ?? []} queue={{ documentId: id }} showCourse={false} showStatus loading={items.isLoading} emptyTitle={t('org.course.noItems')} caption={items.data ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('org.ws.results', { count: items.data.total })}</Text> : undefined} />
      <ErrorText error={items.error} />
    </View>
  );

  return (
    <WorkspaceShell {...ctx} active="courses" title={d.title} subtitle={meta} back={back} onRefresh={() => course.refetch()} refreshing={course.isRefetching}>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space(5), alignItems: 'flex-start' }}>
        {summary}
        {generation}
      </View>
      {questions}
    </WorkspaceShell>
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
          <View style={{ flexDirection: 'row', gap: space(3) }}>
            <View style={{ flex: 1 }}>
              <Field label={t('org.course.generate.count', { max: MAX_ITEMS_PER_GENERATION })} value={count} onChangeText={setCount} keyboardType="number-pad" inputMode="numeric" maxLength={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('org.course.generate.pageStart')} value={pageStart} onChangeText={setPageStart} keyboardType="number-pad" inputMode="numeric" placeholder="1" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('org.course.generate.pageEnd')} value={pageEnd} onChangeText={setPageEnd} keyboardType="number-pad" inputMode="numeric" placeholder={pageCount != null ? String(pageCount) : ''} />
            </View>
          </View>
          <Body muted style={{ fontSize: 13 }}>{t('org.course.generate.pagesHint')}</Body>
          {topics.length > 0 && (
            <View style={{ gap: space(2) }}>
              <SectionLabel>{t('org.course.generate.topic')}</SectionLabel>
              <Chips options={[{ value: '', label: t('org.course.generate.allTopics') }, ...topics.map((x) => ({ value: x, label: x }))]} value={topic} onChange={setTopic} />
            </View>
          )}
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
          <SmallButton title={t('org.course.generate.button')} variant="primary" onPress={() => generate.mutate()} disabled={!countOk || !pagesOk} style={{ alignSelf: 'flex-start' }} />
        </>
      )}
      {result && (
        <View style={{ backgroundColor: colors.successSoft, borderRadius: 10, padding: space(3), gap: space(2) }}>
          <Body style={{ fontWeight: '600', fontSize: 14 }}>{t('org.course.generate.result', { added: result.items.length, discarded: result.discarded })}</Body>
          <Body muted style={{ fontSize: 13 }}>{t('org.course.generate.resultHint')}</Body>
          <SmallButton title={t('org.dashboard.reviewDrafts')} variant="ghost" onPress={() => router.push({ pathname: '/org/review', params: { orgId: org.id, documentId: courseId } })} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
      <ErrorText error={generate.error} />
    </Card>
  );
}
