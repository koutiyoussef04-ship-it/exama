import type { CourseMaterialDetail, KnowledgeTopic } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';
import { useMaterialKindLabel, useMaterialTitle } from '@/components/materials';
import { Badge, Body, Button, Card, colors, ContentDirection, ErrorState, ErrorText, Loading, Screen, SectionLabel, space, TextButton, Title } from '@/components/ui';
import { platform, track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { handleLimitError } from '@/lib/billing';
import { confirm } from '@/lib/confirm';
import { documentErrorMessage } from '@/lib/errors';
import { formatDuration, isActive } from '@/lib/materials';

/** One added material: live processing steps, then what Exama learned from it. */
export default function MaterialScreen() {
  const { t } = useTranslation();
  const { id, documentId } = useLocalSearchParams<{ id: string; documentId: string }>();
  const qc = useQueryClient();
  const titleOf = useMaterialTitle();
  const kindLabel = useMaterialKindLabel();
  const material = useQuery({
    queryKey: ['material', documentId, id],
    queryFn: () => api.getMaterial(documentId, id),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? 3000 : false),
  });

  const opened = useRef(false);
  useEffect(() => {
    const m = material.data;
    if (opened.current || !m) return;
    opened.current = true;
    track('material_opened', { platform, document_id: documentId, material_id: id, kind: m.kind, status: m.status });
  }, [material.data, documentId, id]);

  const refreshCourse = () => {
    for (const key of [['materials', documentId], ['document', documentId], ['progress', documentId], ['study-plan', documentId], ['entitlement']]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
  const retry = useMutation({
    mutationFn: () => api.retryMaterial(documentId, id),
    onError: (err) => handleLimitError(err),
    onSuccess: () => {
      void material.refetch();
      refreshCourse();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteMaterial(documentId, id),
    onSuccess: () => {
      refreshCourse();
      router.back();
    },
  });
  const askRemove = async () => {
    const ok = await confirm({ title: t('materials.removeTitle'), message: t('materials.removeMessage'), confirmText: t('materials.remove'), destructive: true });
    if (ok) remove.mutate();
  };

  if (material.isLoading) return <Loading />;
  const m = material.data;
  if (!m) {
    return (
      <Screen>
        <ErrorState error={material.error} onRetry={() => material.refetch()} />
      </Screen>
    );
  }

  const meta = [kindLabel(m), m.durationSeconds ? formatDuration(m.durationSeconds) : m.pageCount ? t(m.format === 'pptx' ? 'home.slides' : 'home.pages', { count: m.pageCount }) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen onRefresh={() => material.refetch()} refreshing={material.isRefetching}>
      <Stack.Screen options={{ title: kindLabel(m) }} />
      <View style={{ gap: space(1) }}>
        <Title>{titleOf(m)}</Title>
        <Body muted>{meta}</Body>
      </View>

      {isActive(m) && <Steps material={m} />}

      {m.status === 'failed' && (
        <Card style={{ gap: space(3) }}>
          <Badge label={t('materials.statusFailed')} tone="danger" />
          <Body>{documentErrorMessage(m.errorCode, null)}</Body>
          {m.canRetry ? (
            <Button title={t('common.tryAgain')} onPress={() => retry.mutate()} loading={retry.isPending} />
          ) : (
            <Body muted style={{ fontSize: 14 }}>{t('materials.uploadAgain')}</Body>
          )}
          <ErrorText error={retry.error} />
        </Card>
      )}

      {m.status === 'ready' && m.knowledge && <Knowledge material={m} />}

      <TextButton title={remove.isPending ? t('materials.removing') : t('materials.remove')} tone="danger" onPress={askRemove} disabled={remove.isPending} />
      <ErrorText error={remove.error} />
    </Screen>
  );
}

/** Processing → Transcribing → Extracting key concepts → Adding to your course. */
function Steps({ material: m }: { material: CourseMaterialDetail }) {
  const { t } = useTranslation();
  const steps: readonly ('processing' | 'transcribing' | 'analyzing' | 'adding')[] =
    m.kind === 'pdf' ? ['processing', 'analyzing', 'adding'] : ['processing', 'transcribing', 'analyzing', 'adding'];
  const current = steps.indexOf(m.status === 'processing' ? 'processing' : m.status === 'transcribing' ? 'transcribing' : 'analyzing');
  return (
    <Card style={{ gap: space(3) }}>
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 28 }} accessibilityLiveRegion={now ? 'polite' : 'none'}>
            <View style={{ width: 22, alignItems: 'center' }}>
              {now ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={{ color: done ? colors.success : colors.border, fontSize: 16, fontWeight: '800' }} accessibilityElementsHidden importantForAccessibility="no">
                  {done ? '✓' : '•'}
                </Text>
              )}
            </View>
            <Text style={{ flex: 1, color: now ? colors.text : colors.muted, fontSize: 15, fontWeight: now ? '600' : '400' }}>
              {t(`materials.step_${m.kind === 'pdf' && s === 'processing' ? 'reading' : s}`)}
            </Text>
          </View>
        );
      })}
      <Body muted style={{ fontSize: 13, lineHeight: 19 }}>{t('materials.workingDetail')}</Body>
    </Card>
  );
}

function Knowledge({ material: m }: { material: CourseMaterialDetail }) {
  const { t } = useTranslation();
  const k = m.knowledge!;
  return (
    <>
      <Card style={{ gap: space(3) }}>
        <SectionLabel>{t('materials.summary')}</SectionLabel>
        <ContentDirection language={m.language}>
          <Body>{k.summary}</Body>
        </ContentDirection>
        {k.basis === 'transcript' && <Body muted style={{ fontSize: 13, lineHeight: 19 }}>{t('materials.transcriptOnly')}</Body>}
        {m.newTopics.length > 0 && <Body muted style={{ fontSize: 13 }}>{t('materials.addedTopics', { topics: m.newTopics.join(', ') })}</Body>}
      </Card>
      <SectionLabel>{t('materials.topicsTitle')}</SectionLabel>
      {k.topics.map((topic) => (
        <TopicCard key={topic.name} topic={topic} language={m.language} slides={m.format === 'pptx'} />
      ))}
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: space(1) }}>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>{title}</Text>
      {items.map((x, i) => (
        <Body key={i} style={{ fontSize: 15, lineHeight: 21 }}>
          {`• ${x}`}
        </Body>
      ))}
    </View>
  );
}

function TopicCard({ topic, language, slides = false }: { topic: KnowledgeTopic; language: string | null; slides?: boolean }) {
  const { t } = useTranslation();
  const where =
    topic.startSeconds !== null ? t('materials.atTime', { time: formatDuration(Math.max(1, topic.startSeconds)) }) : topic.page ? t(slides ? 'materials.onSlide' : 'materials.onPage', { page: topic.page }) : null;
  return (
    <Card style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', flexShrink: 1 }}>{topic.name}</Text>
        {topic.isNew && <Badge label={t('materials.newBadge')} tone="primary" />}
        {!!where && <Text style={{ color: colors.muted, fontSize: 13 }}>{where}</Text>}
      </View>
      <ContentDirection language={language} style={{ gap: space(3) }}>
        <List title={t('materials.keyPoints')} items={topic.keyPoints} />
        <List title={t('materials.definitions')} items={topic.definitions.map((d) => `${d.term}: ${d.definition}`)} />
        <List title={t('materials.examples')} items={topic.examples} />
        <List title={t('materials.examConcepts')} items={topic.examConcepts} />
      </ContentDirection>
      {topic.relatedTopics.length > 0 && <Body muted style={{ fontSize: 13 }}>{t('materials.related', { topics: topic.relatedTopics.join(', ') })}</Body>}
    </Card>
  );
}
