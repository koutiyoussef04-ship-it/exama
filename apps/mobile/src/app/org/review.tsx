/**
 * Review queue: every draft question (AI-written or added by hand) as a searchable, filterable table.
 * Opening a row shows the question next to its source; the table's filters become that screen's queue.
 */
import type { AttentionFilter } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { QuestionTable } from '@/components/org/question-table';
import { FilterSelect, OrgGate, Pagination, SearchField, Segmented, Toolbar, WorkspaceShell, type OrgContext } from '@/components/org/workspace';
import { colors } from '@/components/ui';
import { api } from '@/lib/api';

const PAGE = 50;
type Attention = 'all' | AttentionFilter;

export default function OrgReviewScreen() {
  return <OrgGate>{(ctx) => <Review {...ctx} />}</OrgGate>;
}

function Review(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const params = useLocalSearchParams<{ documentId?: string; q?: string; attention?: string }>();
  const [courseId, setCourseId] = useState(params.documentId ?? '');
  const [q, setQ] = useState(params.q ?? '');
  const [attention, setAttention] = useState<Attention>(params.attention === 'flagged' || params.attention === 'clean' ? params.attention : 'all');
  const [offset, setOffset] = useState(0);

  const courses = useQuery({ queryKey: ['org', org.id, 'courses'], queryFn: () => api.orgCourses(org.id) });
  const filters = { status: 'draft' as const, documentId: courseId || undefined, q: q || undefined, attention: attention === 'all' ? undefined : attention };
  const drafts = useQuery({
    queryKey: ['org', org.id, 'items', { ...filters, offset, limit: PAGE }],
    queryFn: () => api.orgItems(org.id, { ...filters, limit: PAGE, offset }),
    placeholderData: (prev) => prev,
  });
  const total = drafts.data?.total ?? 0;
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  return (
    <WorkspaceShell {...ctx} active="review" title={t('org.ws.review.title')} subtitle={t('org.ws.review.subtitle')} draftCount={attention === 'all' && !q && !courseId ? total : undefined} onRefresh={() => drafts.refetch()} refreshing={drafts.isRefetching}>
      <Toolbar>
        <SearchField value={q} onChange={change(setQ)} placeholder={t('org.ws.search')} />
        {!!courses.data?.length && <FilterSelect label={t('org.ws.filters.course')} value={courseId} options={[{ value: '', label: t('org.review.allCourses') }, ...courses.data.map((c) => ({ value: c.id, label: c.title }))]} onChange={change(setCourseId)} />}
        <Segmented<Attention>
          label={t('org.ws.filters.attention')}
          value={attention}
          onChange={change(setAttention)}
          options={[
            { value: 'all', label: t('org.ws.attention.all') },
            { value: 'flagged', label: t('org.ws.attention.flagged') },
            { value: 'clean', label: t('org.ws.attention.clean') },
          ]}
        />
      </Toolbar>
      <QuestionTable
        orgId={org.id}
        items={drafts.data?.items ?? []}
        queue={{ status: 'draft', documentId: courseId, q, attention: attention === 'all' ? '' : attention }}
        showCourse={!courseId}
        loading={drafts.isLoading}
        emptyTitle={q || attention !== 'all' ? t('org.ws.noResults') : t('org.review.empty')}
        emptyHint={q || attention !== 'all' ? t('org.ws.noResultsHint') : t('org.review.emptyHint')}
        caption={<Text style={{ color: colors.muted, fontSize: 13 }}>{drafts.error ? t('common.somethingWrong') : t('org.ws.results', { count: total })}</Text>}
        footer={total <= PAGE ? undefined : <Pagination offset={offset} limit={PAGE} total={total} onChange={setOffset} />}
      />
    </WorkspaceShell>
  );
}
