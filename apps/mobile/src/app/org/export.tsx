/**
 * Export approved questions as CSV, Moodle GIFT, Excel or PDF, optionally for one course or topic. The server builds
 * the file from approved items only; the web app downloads it, the native apps show the text formats to copy
 * (Excel and PDF are web downloads). The PDF has two versions, chosen here before exporting and applied by the
 * server: the student version (no answers) is the default, so answers are never disclosed by accident.
 */
import { EXPORT_FORMATS, isTextExportFormat, PDF_MODES, type ExportFormat, type PdfMode } from '@study/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, TextInput, View } from 'react-native';
import { FilterSelect, OrgGate, Segmented, SmallButton, Toolbar, WorkspaceShell, type OrgContext } from '@/components/org/workspace';
import { Body, Card, colors, ErrorText, SectionLabel, space } from '@/components/ui';
import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';
import { copyText } from '@/lib/support';

type Exported = { bytes: Uint8Array; contentType: string; filename: string; count: number; format: ExportFormat };

/** The text formats as text, for the copy button and the native apps (without the CSV's byte-order mark). */
const exportedText = (r: Exported) => (isTextExportFormat(r.format) ? new TextDecoder('utf-8').decode(r.bytes) : '');

export default function OrgExportScreen() {
  return <OrgGate>{(ctx) => <Export {...ctx} />}</OrgGate>;
}

/** Web only: hands the file to the browser as a download, bytes as sent by the API. Returns false where that is not possible. */
function downloadFile({ bytes, contentType, filename }: Exported): boolean {
  if (Platform.OS !== 'web') return false;
  const g = globalThis as { document?: Document; URL?: typeof URL; Blob?: typeof Blob };
  const doc = g.document;
  if (!doc || typeof g.Blob !== 'function' || typeof g.URL?.createObjectURL !== 'function') return false;
  try {
    const blob = new g.Blob([bytes as BlobPart], { type: contentType });
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
  const params = useLocalSearchParams<{ documentId?: string; topic?: string }>();
  const [courseId, setCourseId] = useState(params.documentId ?? '');
  const [topic, setTopic] = useState(params.topic ?? '');
  const [format, setFormat] = useState<ExportFormat>('csv');
  // PDF only. Student by default: the version without answers.
  const [pdfMode, setPdfMode] = useState<PdfMode>('student');
  const { appLanguage } = usePreferences();
  const [result, setResult] = useState<Exported | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  const courses = useQuery({ queryKey: ['org', org.id, 'courses'], queryFn: () => api.orgCourses(org.id) });
  const topics = useQuery({ queryKey: ['org', org.id, 'topics', courseId || undefined], queryFn: () => api.orgTopics(org.id, courseId || undefined) });
  const topicOptions = (topics.data ?? []).filter((x) => x.approved > 0).map((x) => x.topic).filter((x, i, arr) => arr.indexOf(x) === i);
  const approvedCount = (topics.data ?? []).filter((x) => !topic || x.topic === topic).reduce((sum, x) => sum + x.approved, 0);

  const exportNow = useMutation({
    mutationFn: async (): Promise<Exported> => ({
      ...(await api.orgExport(org.id, format, { documentId: courseId || undefined, topic: topic || undefined, ...(format === 'pdf' ? { mode: pdfMode, language: appLanguage } : {}) })),
      format,
    }),
    onSuccess: (res) => {
      setResult(res);
      setCopied(null);
      downloadFile(res);
    },
  });

  const copy = async (text: string) => setCopied(await copyText(text));
  const web = Platform.OS === 'web';
  const textFormat = isTextExportFormat(format);
  // The native apps have no file download: Excel and PDF are exported from the web app.
  const unavailableHere = !web && !textFormat;
  // The format control says "Excel" (not the file extension); the button then says what happens: "Export to Excel".
  const exportLabel = format === 'xlsx' ? t('org.export.buttonExcel') : t('org.export.button');

  return (
    <WorkspaceShell {...ctx} active="export" title={t('org.ws.export.title')} subtitle={t('org.export.intro')} maxWidth={880}>
      <Card style={{ gap: space(4) }}>
        <Toolbar>
          {!!courses.data?.length && (
            <FilterSelect
              label={t('org.bank.course')}
              value={courseId}
              options={[{ value: '', label: t('org.bank.allCourses') }, ...courses.data.map((c) => ({ value: c.id, label: c.title }))]}
              onChange={(v) => {
                setCourseId(v);
                setTopic('');
              }}
            />
          )}
          {topicOptions.length > 0 && <FilterSelect label={t('org.bank.topic')} value={topic} options={[{ value: '', label: t('org.bank.allTopics') }, ...topicOptions.map((x) => ({ value: x, label: x }))]} onChange={setTopic} />}
        </Toolbar>
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('org.export.format')}</SectionLabel>
          <Segmented options={EXPORT_FORMATS.map((f) => ({ value: f, label: t(`org.export.formats.${f}`) }))} value={format} onChange={setFormat} label={t('org.export.format')} wrap />
        </View>
        {format === 'pdf' && (
          <View style={{ gap: space(2) }}>
            <SectionLabel>{t('org.export.pdfMode')}</SectionLabel>
            <Segmented options={PDF_MODES.map((m) => ({ value: m, label: t(`org.export.pdfModes.${m}`) }))} value={pdfMode} onChange={setPdfMode} label={t('org.export.pdfMode')} />
            <Body muted style={{ fontSize: 13 }}>{t(`org.export.pdfModeHint.${pdfMode}`)}</Body>
          </View>
        )}
        {unavailableHere && <Body muted style={{ fontSize: 13 }}>{t('org.export.webOnly')}</Body>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(3) }}>
          <SmallButton title={exportLabel} variant="primary" icon="export" onPress={() => exportNow.mutate()} loading={exportNow.isPending} disabled={unavailableHere || (!topics.isLoading && approvedCount === 0)} />
          <Body style={{ fontWeight: '600', fontSize: 14 }}>{topics.isLoading ? t('org.export.counting') : t('org.export.approvedCount', { count: approvedCount })}</Body>
        </View>
        {!topics.isLoading && approvedCount === 0 && <Body muted style={{ fontSize: 13 }}>{t('org.export.nothing')}</Body>}
        <ErrorText error={exportNow.error ?? topics.error} />
      </Card>

      {result && (
        <Card style={{ gap: space(3) }}>
          <SectionLabel>{t('org.export.resultTitle')}</SectionLabel>
          <Body style={{ fontSize: 14 }}>{t('org.export.done', { count: result.count, filename: result.filename })}</Body>
          {!web && isTextExportFormat(result.format) && (
            <>
              <Body muted style={{ fontSize: 13 }}>{t('org.export.nativeHint')}</Body>
              <TextInput value={exportedText(result)} editable={false} multiline scrollEnabled accessibilityLabel={t('org.export.textLabel')} style={{ minHeight: 160, maxHeight: 320, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: space(3), fontSize: 13, color: colors.text }} />
            </>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {web && <SmallButton title={t('org.export.downloadAgain')} icon="export" onPress={() => downloadFile(result)} />}
            {isTextExportFormat(result.format) && <SmallButton title={t('org.export.copy')} variant="ghost" onPress={() => void copy(exportedText(result))} />}
          </View>
          {copied === true && <Body style={{ color: colors.success, fontSize: 13 }}>{t('org.export.copied')}</Body>}
          {copied === false && <Body muted style={{ fontSize: 13 }}>{t('org.export.copyFailed')}</Body>}
        </Card>
      )}
    </WorkspaceShell>
  );
}
