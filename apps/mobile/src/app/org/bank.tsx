/**
 * Question bank: the approved questions as a searchable table (course, topic, checks), with the export
 * one click away. Editors can add a question by hand — it starts as a draft and goes through review
 * like every other question.
 */
import { marketProfile, type BankItemType, type TopicCount } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { draftToInput, emptyDraft, ItemFields, validateDraft, type DraftProblem, type ItemDraft } from '@/components/org/item-form';
import { QuestionTable } from '@/components/org/question-table';
import { FilterSelect, OrgGate, Pagination, SearchField, SmallButton, Toolbar, useIsWide, WorkspaceShell, type OrgContext } from '@/components/org/workspace';
import { Chips } from '@/components/planner';
import { Body, Card, colors, ErrorText, SectionLabel, space } from '@/components/ui';
import { api } from '@/lib/api';
import { canEdit } from '@/lib/org';

const PAGE = 50;

export default function OrgBankScreen() {
  return <OrgGate>{(ctx) => <Bank {...ctx} />}</OrgGate>;
}

function Bank(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const profile = marketProfile(org.market);
  const [courseId, setCourseId] = useState('');
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);

  const courses = useQuery({ queryKey: ['org', org.id, 'courses'], queryFn: () => api.orgCourses(org.id) });
  const topics = useQuery({ queryKey: ['org', org.id, 'topics', courseId || undefined], queryFn: () => api.orgTopics(org.id, courseId || undefined) });
  const filters = { status: 'approved' as const, documentId: courseId || undefined, topic: topic || undefined, q: q || undefined };
  const approved = useQuery({
    queryKey: ['org', org.id, 'items', { ...filters, offset, limit: PAGE }],
    queryFn: () => api.orgItems(org.id, { ...filters, limit: PAGE, offset }),
    placeholderData: (prev) => prev,
  });
  const total = approved.data?.total ?? 0;
  const topicOptions = useMemo(() => (topics.data ?? []).filter((x) => x.approved > 0).map((x) => x.topic).filter((x, i, arr) => arr.indexOf(x) === i), [topics.data]);
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  return (
    <WorkspaceShell
      {...ctx}
      active="bank"
      title={t('org.ws.bank.title')}
      subtitle={t('org.ws.bank.subtitle')}
      actions={
        <>
          {canEdit(org.role) && <SmallButton title={t('org.bank.add')} icon="plus" onPress={() => setAdding((v) => !v)} disabled={!courses.data?.length} />}
          <SmallButton title={t('org.nav.export')} icon="export" variant="primary" onPress={() => router.push({ pathname: '/org/export', params: { orgId: org.id, ...(courseId && { documentId: courseId }), ...(topic && { topic }) } })} disabled={total === 0} />
        </>
      }
      onRefresh={() => approved.refetch()}
      refreshing={approved.isRefetching}
    >
      {adding && canEdit(org.role) && <AddItemCard ctx={ctx} courses={courses.data ?? []} topics={topics.data ?? []} onDone={() => setAdding(false)} />}
      <Toolbar>
        <SearchField value={q} onChange={change(setQ)} placeholder={t('org.ws.search')} />
        {!!courses.data?.length && (
          <FilterSelect
            label={t('org.ws.filters.course')}
            value={courseId}
            options={[{ value: '', label: t('org.bank.allCourses') }, ...courses.data.map((c) => ({ value: c.id, label: c.title }))]}
            onChange={(v) => {
              change(setCourseId)(v);
              setTopic('');
            }}
          />
        )}
        {topicOptions.length > 0 && <FilterSelect label={t('org.ws.filters.topic')} value={topic} options={[{ value: '', label: t('org.bank.allTopics') }, ...topicOptions.map((x) => ({ value: x, label: x }))]} onChange={change(setTopic)} />}
      </Toolbar>
      <QuestionTable
        orgId={org.id}
        items={approved.data?.items ?? []}
        queue={{ status: 'approved', documentId: courseId, q }}
        showCourse={!courseId}
        loading={approved.isLoading}
        emptyTitle={q || topic ? t('org.ws.noResults') : t('org.bank.empty')}
        emptyHint={q || topic ? t('org.ws.noResultsHint') : t('org.bank.emptyHint')}
        caption={<Text style={{ color: colors.muted, fontSize: 13 }}>{approved.error ? t('common.somethingWrong') : t('org.ws.results', { count: total })}</Text>}
        footer={total <= PAGE ? undefined : <Pagination offset={offset} limit={PAGE} total={total} onChange={setOffset} />}
      />
    </WorkspaceShell>
  );
}

function AddItemCard({ ctx, courses, topics, onDone }: { ctx: OrgContext; courses: { id: string; title: string }[]; topics: TopicCount[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { org } = ctx;
  const qc = useQueryClient();
  const wide = useIsWide();
  const profile = marketProfile(org.market);
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [type, setType] = useState<BankItemType>('mcq');
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft('mcq', profile.optionCount));
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const suggestions = topics.map((x) => x.topic).filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 12);

  const create = useMutation({
    mutationFn: () => api.orgCreateItem(org.id, { documentId: courseId, type, ...draftToInput(draft, type, profile.legalMetadata) }),
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: ['org', org.id] });
      onDone();
      router.push({ pathname: '/org/items/[id]', params: { id: item.id, orgId: org.id } });
    },
  });

  const changeType = (next: BankItemType) => {
    setType(next);
    setDraft((d) => ({ ...d, options: next === 'mcq' ? (d.options.length ? d.options : emptyDraft('mcq', profile.optionCount).options) : [] }));
  };
  const submit = () => {
    if (!courseId) return setProblem('org.item.required');
    const bad = validateDraft(draft, type, profile.legalMetadata);
    setProblem(bad);
    if (!bad) create.mutate();
  };

  return (
    <Card style={{ gap: space(4), maxWidth: wide ? 820 : undefined }}>
      <View style={{ gap: space(1) }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{t('org.ws.bank.addTitle')}</Text>
        <Body muted style={{ fontSize: 14 }}>{t('org.bank.addIntro')}</Body>
      </View>
      <View style={{ gap: space(2) }}>
        <SectionLabel>{t('org.bank.course')}</SectionLabel>
        <Chips options={courses.map((c) => ({ value: c.id, label: c.title }))} value={courseId} onChange={setCourseId} />
      </View>
      {!profile.mcqOnly && (
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('org.bank.type')}</SectionLabel>
          <Chips<BankItemType>
            options={[
              { value: 'mcq', label: t('org.type.mcq') },
              { value: 'short_answer', label: t('org.type.short_answer') },
            ]}
            value={type}
            onChange={changeType}
          />
        </View>
      )}
      {suggestions.length > 0 && (
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('org.bank.existingTopics')}</SectionLabel>
          <Chips options={suggestions.map((x) => ({ value: x, label: x }))} value={draft.topic} onChange={(v) => setDraft({ ...draft, topic: v })} />
        </View>
      )}
      <ItemFields
        draft={draft}
        type={type}
        market={org.market}
        disabled={create.isPending}
        onChange={(next) => {
          setDraft(next);
          setProblem(null);
        }}
      />
      {problem && <Body style={{ color: colors.danger, fontSize: 14 }}>{t(problem)}</Body>}
      <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
        <SmallButton title={t('org.bank.create')} variant="primary" onPress={submit} loading={create.isPending} />
        <SmallButton title={t('common.cancel')} variant="ghost" onPress={onDone} disabled={create.isPending} />
      </View>
      <ErrorText error={create.error} />
    </Card>
  );
}
