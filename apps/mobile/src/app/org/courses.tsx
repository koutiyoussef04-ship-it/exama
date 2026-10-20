/**
 * Organization courses: the uploaded PDFs/PowerPoints that questions are generated from, as a table.
 * Editors upload; the list polls while a course is still being processed by the server.
 */
import type { DocumentSummary } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { CellText, DataTable, OrgGate, SmallButton, WorkspaceShell, type Column, type OrgContext } from '@/components/org/workspace';
import { Badge, colors, ErrorText, space } from '@/components/ui';
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
  const pages = (d: DocumentSummary) => (d.pageCount != null ? t(d.format === 'pptx' ? 'org.courses.slides' : 'org.courses.pages', { count: d.pageCount }) : '');

  const columns: Column<DocumentSummary>[] = [
    { key: 'title', title: t('org.ws.columns.course'), flex: 4, render: (d) => <CellText bold>{d.title}</CellText> },
    { key: 'pages', title: t('org.ws.columns.pages'), width: 120, render: (d) => <CellText muted lines={1}>{pages(d)}</CellText> },
    { key: 'status', title: t('org.ws.columns.status'), width: 130, render: (d) => <Badge label={statusLabel(d.status)} tone={STATUS_TONE[d.status]} /> },
    { key: 'added', title: t('org.ws.columns.added'), width: 110, align: 'right', render: (d) => <CellText muted lines={1}>{formatDate(d.createdAt)}</CellText> },
  ];

  return (
    <WorkspaceShell
      {...ctx}
      active="courses"
      title={t('org.ws.courses.title')}
      subtitle={editor ? t('org.courses.uploadHint') : t('org.courses.readOnly')}
      actions={editor ? <SmallButton title={upload.isPending ? t('org.courses.uploading') : t('org.courses.upload')} icon="upload" variant="primary" onPress={() => upload.mutate()} loading={upload.isPending} /> : undefined}
      onRefresh={() => courses.refetch()}
      refreshing={courses.isRefetching}
    >
      <ErrorText error={upload.error ?? courses.error} />
      <DataTable
        columns={columns}
        rows={courses.data ?? []}
        keyOf={(d) => d.id}
        rowLabel={(d) => `${d.title}, ${statusLabel(d.status)}`}
        onRowPress={(d) => open(d.id)}
        loading={courses.isLoading}
        emptyTitle={t('org.courses.empty')}
        emptyHint={t('org.courses.emptyHint')}
        renderCard={(d) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <View style={{ flex: 1, gap: 2 }}>
              <CellText bold>{d.title}</CellText>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{[pages(d), formatDate(d.createdAt)].filter(Boolean).join(' · ')}</Text>
            </View>
            <Badge label={statusLabel(d.status)} tone={STATUS_TONE[d.status]} />
          </View>
        )}
      />
    </WorkspaceShell>
  );
}
