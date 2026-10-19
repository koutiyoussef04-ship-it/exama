/**
 * Export approved questions as CSV or GIFT (Moodle), optionally for one course or topic. The server builds
 * the file from approved items only; the web app downloads it, the native apps show the text to copy.
 */
import { EXPORT_FORMATS, type ExportFormat } from '@study/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, TextInput, View } from 'react-native';
import { OrgGate, OrgNav, type OrgContext } from '@/components/org/org-nav';
import { Chips } from '@/components/planner';
import { Body, Button, Card, colors, ErrorText, Screen, SectionLabel, space, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { copyText } from '@/lib/support';

type Exported = { text: string; filename: string; count: number; format: ExportFormat };

export default function OrgExportScreen() {
  return <OrgGate>{(ctx) => <Export {...ctx} />}</OrgGate>;
}

/** Web only: hands the text to the browser as a file download. Returns false where that is not possible. */
function downloadText({ text, filename, format }: Exported): boolean {
  if (Platform.OS !== 'web') return false;
  const g = globalThis as { document?: Document; URL?: typeof URL; Blob?: typeof Blob };
  const doc = g.document;
  if (!doc || typeof g.Blob !== 'function' || typeof g.URL?.createObjectURL !== 'function') return false;
  try {
    const blob = new g.Blob([text], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = g.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => g.URL?.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

function Export(ctx: OrgContext) {
  const { t } = useTranslation();
  const { org } = ctx;
  const [courseId, setCourseId] = useState('');
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [result, setResult] = useState<Exported | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  const courses = useQuery({ queryKey: ['org', org.id, 'courses'], queryFn: () => api.orgCourses(org.id) });
  const topics = useQuery({ queryKey: ['org', org.id, 'topics', courseId || undefined], queryFn: () => api.orgTopics(org.id, courseId || undefined) });
  const topicOptions = (topics.data ?? []).filter((x) => x.approved > 0).map((x) => x.topic).filter((x, i, arr) => arr.indexOf(x) === i);
  const approvedCount = (topics.data ?? []).filter((x) => !topic || x.topic === topic).reduce((sum, x) => sum + x.approved, 0);

  const exportNow = useMutation({
    mutationFn: async (): Promise<Exported> => ({ ...(await api.orgExport(org.id, format, { documentId: courseId || undefined, topic: topic || undefined })), format }),
    onSuccess: (res) => {
      setResult(res);
      setCopied(null);
      downloadText(res);
    },
  });

  const copy = async (text: string) => setCopied(await copyText(text));
  const web = Platform.OS === 'web';

  return (
    <Screen>
      <OrgNav {...ctx} active="export" />
      <Body muted style={{ fontSize: 14 }}>{t('org.export.intro')}</Body>

      <Card style={{ gap: space(4) }}>
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
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('org.export.format')}</SectionLabel>
          <Chips options={EXPORT_FORMATS.map((f) => ({ value: f, label: t(`org.export.formats.${f}`) }))} value={format} onChange={setFormat} />
        </View>
        <Body style={{ fontWeight: '600' }}>{topics.isLoading ? t('org.export.counting') : t('org.export.approvedCount', { count: approvedCount })}</Body>
        <Button title={t('org.export.button')} onPress={() => exportNow.mutate()} loading={exportNow.isPending} disabled={!topics.isLoading && approvedCount === 0} />
        {!topics.isLoading && approvedCount === 0 && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('org.export.nothing')}</Body>}
        <ErrorText error={exportNow.error ?? topics.error} />
      </Card>

      {result && (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('org.export.resultTitle')}</SectionLabel>
          <Body>{t('org.export.done', { count: result.count, filename: result.filename })}</Body>
          {web ? (
            <Button variant="secondary" title={t('org.export.downloadAgain')} onPress={() => downloadText(result)} />
          ) : (
            <>
              <Body muted style={{ fontSize: 13 }}>{t('org.export.nativeHint')}</Body>
              <TextInput
                value={result.text}
                editable={false}
                multiline
                scrollEnabled
                accessibilityLabel={t('org.export.textLabel')}
                style={{ minHeight: 160, maxHeight: 320, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: space(3), fontSize: 13, color: colors.text }}
              />
            </>
          )}
          <TextButton title={t('org.export.copy')} onPress={() => void copy(result.text)} />
          {copied === true && <Body style={{ color: colors.success, fontSize: 14, textAlign: 'center' }}>{t('org.export.copied')}</Body>}
          {copied === false && <Body muted style={{ fontSize: 13, textAlign: 'center' }}>{t('org.export.copyFailed')}</Body>}
        </Card>
      )}
    </Screen>
  );
}
