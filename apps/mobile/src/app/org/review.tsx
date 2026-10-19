/**
 * Review queue: every draft question (AI-written or added by hand) with its review flags, verification
 * verdict and whether its source quote was located. Opening one shows the source and the approve/reject actions.
 */
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ItemRow } from '@/components/org/item-form';
import { OrgGate, OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Chips } from '@/components/planner';
import { Body, Card, EmptyState, ErrorState, Loading, Screen, SectionLabel, space } from '@/components/ui';
import { api } from '@/lib/api';

export default function OrgReviewScreen() {
  return <OrgGate>{(ctx) => <Review {...ctx} />}</OrgGate>;
}

function Review(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const { documentId: initialCourse } = useLocalSearchParams<{ documentId?: string }>();
  const [courseId, setCourseId] = useState(initialCourse ?? '');

  const courses = useQuery({ queryKey: ['org', org.id, 'courses'], queryFn: () => api.orgCourses(org.id) });
  const drafts = useQuery({
    queryKey: ['org', org.id, 'items', { status: 'draft', documentId: courseId || undefined }],
    queryFn: () => api.orgItems(org.id, { status: 'draft', documentId: courseId || undefined, limit: 200 }),
  });

  return (
    <Screen onRefresh={() => drafts.refetch()} refreshing={drafts.isRefetching}>
      <OrgNav {...ctx} active="review" />
      <Body muted style={{ fontSize: 14 }}>{t('org.review.intro')}</Body>

      {!!courses.data?.length && (
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('org.review.course')}</SectionLabel>
          <Chips options={[{ value: '', label: t('org.review.allCourses') }, ...courses.data.map((c) => ({ value: c.id, label: c.title }))]} value={courseId} onChange={setCourseId} />
        </View>
      )}

      {drafts.isLoading && <Loading />}
      {drafts.error && !drafts.data && <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} />}
      {drafts.data && drafts.data.items.length === 0 && (
        <EmptyState title={t('org.review.empty')}>
          <Body muted style={{ textAlign: 'center' }}>{t('org.review.emptyHint')}</Body>
        </EmptyState>
      )}
      {drafts.data && drafts.data.items.length > 0 && (
        <Card style={{ gap: 0 }}>
          <SectionLabel>{t('org.review.count', { count: drafts.data.total })}</SectionLabel>
          {drafts.data.items.map((it, i) => (
            <ItemRow key={it.id} item={it} showStatus={false} last={i === drafts.data.items.length - 1} onPress={() => router.push({ pathname: '/org/items/[id]', params: { id: it.id, orgId: org.id } })} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
