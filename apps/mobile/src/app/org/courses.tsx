/**
 * Organization courses: the uploaded PDFs/PowerPoints that questions are generated from. Editors upload;
 * the list polls while a course is still being processed by the server.
 */
import type { DocumentSummary } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { OrgGate, OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Badge, Body, Button, Card, Chevron, colors, EmptyState, ErrorState, ErrorText, Loading, Screen, space } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { canEdit } from '@/lib/org';
import { usePreferences } from '@/lib/preferences';

const COURSE_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
const STATUS_TONE: Record<DocumentSummary['status'], 'primary' | 'success' | 'danger'> = { processing: 'primary', ready: 'success', failed: 'danger' };

export default function OrgCoursesScreen() {
  return <OrgGate>{(ctx) => <Courses {...ctx} />}</OrgGate>;
}

function Courses(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const qc = useQueryClient();
  const { aiLanguage } = usePreferences();
  const editor = canEdit(org.role);

  const courses = useQuery({
    queryKey: ['org', org.id, 'courses'],
    queryFn: () => api.orgCourses(org.id),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === 'processing') ? 2000 : false),
  });

  const upload = useMutation({
    mutationFn: async () => {
      const res = await DocumentPicker.getDocumentAsync({ type: COURSE_TYPES, copyToCacheDirectory: true });
      if (res.canceled) return null;
      const a = res.assets[0];
      return api.orgUploadCourse(org.id, { uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file }, aiLanguage);
    },
    onSuccess: (doc) => {
      if (!doc) return;
      void qc.invalidateQueries({ queryKey: ['org', org.id] });
      router.push({ pathname: '/org/courses/[id]', params: { id: doc.id, orgId: org.id } });
    },
  });

  const statusLabel = (s: DocumentSummary['status']) => t(`org.courses.status.${s}`);
  const open = (id: string) => router.push({ pathname: '/org/courses/[id]', params: { id, orgId: org.id } });

  return (
    <Screen onRefresh={() => courses.refetch()} refreshing={courses.isRefetching}>
      <OrgNav {...ctx} active="courses" />

      {editor ? (
        <Card style={{ gap: space(3) }}>
          <Body muted style={{ fontSize: 14 }}>{t('org.courses.uploadHint')}</Body>
          <Button title={upload.isPending ? t('org.courses.uploading') : t('org.courses.upload')} onPress={() => upload.mutate()} loading={upload.isPending} />
          <ErrorText error={upload.error} />
        </Card>
      ) : (
        <Body muted style={{ fontSize: 14 }}>{t('org.courses.readOnly')}</Body>
      )}

      {courses.isLoading && <Loading />}
      {courses.error && !courses.data && <ErrorState error={courses.error} onRetry={() => courses.refetch()} />}
      {courses.data && courses.data.length === 0 && (
        <EmptyState title={t('org.courses.empty')}>
          <Body muted style={{ textAlign: 'center' }}>{t('org.courses.emptyHint')}</Body>
        </EmptyState>
      )}
      {courses.data && courses.data.length > 0 && (
        <Card style={{ gap: 0 }}>
          {courses.data.map((d, i) => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={`${d.title}, ${statusLabel(d.status)}`}
              onPress={() => open(d.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(3),
                paddingVertical: space(3),
                borderBottomWidth: i === courses.data.length - 1 ? 0 : 1,
                borderBottomColor: colors.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }} numberOfLines={2}>
                  {d.title}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {[d.pageCount != null ? t(d.format === 'pptx' ? 'org.courses.slides' : 'org.courses.pages', { count: d.pageCount }) : null, formatDate(d.createdAt)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Badge label={statusLabel(d.status)} tone={STATUS_TONE[d.status]} />
              <Chevron />
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}
