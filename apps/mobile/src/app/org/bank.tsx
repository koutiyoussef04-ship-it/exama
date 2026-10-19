/**
 * Question bank: the approved questions, grouped by section (module / tema) and topic, filtered by
 * course and topic. Editors can add a question by hand — it starts as a draft and goes through review
 * like every other question.
 */
import { marketProfile, type BankItem, type BankItemType, type TopicCount } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { draftToInput, emptyDraft, ItemFields, ItemRow, validateDraft, type DraftProblem, type ItemDraft } from '@/components/org/item-form';
import { OrgGate, OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Chips } from '@/components/planner';
import { Body, Button, Card, colors, EmptyState, ErrorState, ErrorText, Loading, Screen, SectionLabel, space, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { canEdit } from '@/lib/org';

export default function OrgBankScreen() {
  return <OrgGate>{(ctx) => <Bank {...ctx} />}</OrgGate>;
}

function Bank(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const profile = marketProfile(org.market);
  const [courseId, setCourseId] = useState('');
  const [topic, setTopic] = useState('');
  const [adding, setAdding] = useState(false);

  const courses = useQuery({ queryKey: ['org', org.id, 'courses'], queryFn: () => api.orgCourses(org.id) });
  const topics = useQuery({ queryKey: ['org', org.id, 'topics', courseId || undefined], queryFn: () => api.orgTopics(org.id, courseId || undefined) });
  const approved = useQuery({
    queryKey: ['org', org.id, 'items', { status: 'approved', documentId: courseId || undefined, topic: topic || undefined }],
    queryFn: () => api.orgItems(org.id, { status: 'approved', documentId: courseId || undefined, topic: topic || undefined, limit: 200 }),
  });

  const topicOptions = useMemo(() => (topics.data ?? []).filter((x) => x.approved > 0).map((x) => x.topic).filter((x, i, arr) => arr.indexOf(x) === i), [topics.data]);
  const groups = useMemo(() => groupBySection(approved.data?.items ?? []), [approved.data]);
  const open = (id: string) => router.push({ pathname: '/org/items/[id]', params: { id, orgId: org.id } });

  return (
    <Screen onRefresh={() => approved.refetch()} refreshing={approved.isRefetching}>
      <OrgNav {...ctx} active="bank" />
      <Body muted style={{ fontSize: 14 }}>{t(`org.bank.intro.${profile.unitLabel}`)}</Body>

      {!!courses.data?.length && (
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('org.bank.course')}</SectionLabel>
          <Chips
            options={[{ value: '', label: t('org.bank.allCourses') }, ...courses.data.map((c) => ({ value: c.id, label: c.title }))]}
            value={courseId}
            onChange={(v) => {
              setCourseId(v);
              setTopic('');
            }}
          />
        </View>
      )}
      {topicOptions.length > 0 && (
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('org.bank.topic')}</SectionLabel>
          <Chips options={[{ value: '', label: t('org.bank.allTopics') }, ...topicOptions.map((x) => ({ value: x, label: x }))]} value={topic} onChange={setTopic} />
        </View>
      )}

      {canEdit(org.role) &&
        (adding ? (
          <AddItemCard ctx={ctx} courses={courses.data ?? []} topics={topics.data ?? []} onDone={() => setAdding(false)} />
        ) : (
          <Button variant="secondary" title={t('org.bank.add')} onPress={() => setAdding(true)} disabled={!courses.data?.length} />
        ))}

      {approved.isLoading && <Loading />}
      {approved.error && !approved.data && <ErrorState error={approved.error} onRetry={() => approved.refetch()} />}
      {approved.data && approved.data.items.length === 0 && (
        <EmptyState title={t('org.bank.empty')}>
          <Body muted style={{ textAlign: 'center' }}>{t('org.bank.emptyHint')}</Body>
        </EmptyState>
      )}
      {approved.data && approved.data.items.length > 0 && <Body muted style={{ fontSize: 13 }}>{t('org.bank.count', { count: approved.data.total })}</Body>}
      {groups.map((g) => (
        <Card key={g.section ?? ''} style={{ gap: space(2) }}>
          <SectionLabel>{g.section ?? t('org.bank.noSection')}</SectionLabel>
          {g.topics.map((tp) => (
            <View key={tp.topic} style={{ gap: 0 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15, marginTop: space(1) }}>{tp.topic}</Text>
              {tp.items.map((it, i) => (
                <ItemRow key={it.id} item={it} showStatus={false} showCourse={!courseId} last={i === tp.items.length - 1} onPress={() => open(it.id)} />
              ))}
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

function groupBySection(items: BankItem[]) {
  const sections = new Map<string | null, Map<string, BankItem[]>>();
  for (const it of items) {
    const section = it.section?.trim() || null;
    const bySection = sections.get(section) ?? new Map<string, BankItem[]>();
    bySection.set(it.topic, [...(bySection.get(it.topic) ?? []), it]);
    sections.set(section, bySection);
  }
  return [...sections.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([section, byTopic]) => ({ section, topics: [...byTopic.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([topic, list]) => ({ topic, items: list })) }));
}

function AddItemCard({ ctx, courses, topics, onDone }: { ctx: OrgContext; courses: { id: string; title: string }[]; topics: TopicCount[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { org } = ctx;
  const qc = useQueryClient();
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
    <Card style={{ gap: space(4) }}>
      <View style={{ gap: space(1) }}>
        <SectionLabel>{t('org.bank.add')}</SectionLabel>
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
      <Button title={t('org.bank.create')} onPress={submit} loading={create.isPending} />
      <TextButton title={t('common.cancel')} tone="muted" onPress={onDone} disabled={create.isPending} />
      <ErrorText error={create.error} />
    </Card>
  );
}
