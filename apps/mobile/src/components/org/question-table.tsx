/**
 * The questions table shared by the review queue, the bank, the dashboard and the course screen: one
 * row per question with its checks (review flags, verifier verdict, source location). Rows open the
 * question screen with the list's filters as its queue, so "next" there follows this list.
 */
import type { BankItem } from '@study/shared';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { CellText, DataTable, queueParams, type Column, type QueueParams } from '@/components/org/workspace';
import { Badge, colors, space } from '@/components/ui';
import { formatDate } from '@/lib/billing';
import { flagLabel, sourceLabel, STATUS_TONE, statusLabel, VERDICT_TONE, verdictLabel } from '@/lib/org';

export type QuestionTableProps = {
  orgId: string;
  items: BankItem[];
  /** The filters this list was loaded with (become the queue of the opened question). */
  queue: QueueParams;
  showCourse?: boolean;
  showStatus?: boolean;
  loading?: boolean;
  emptyTitle: string;
  emptyHint?: string;
  caption?: ReactNode;
  footer?: ReactNode;
};

export const openQuestion = (orgId: string, id: string, queue: QueueParams) => router.push({ pathname: '/org/items/[id]', params: { id, orgId, ...queueParams(queue) } });

/** Flags + verdict + source, as compact badges. */
export function ChecksCell({ item, compact }: { item: BankItem; compact?: boolean }) {
  const { t } = useTranslation();
  const unlocated = item.sources.length > 0 && item.sources.some((s) => !s.located);
  const flags = item.reviewFlags.filter((f) => f !== 'unlocated');
  const clean = flags.length === 0 && !unlocated && item.verification?.verdict === 'supported';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1) }}>
      {clean && <Badge label={t('org.ws.dashboard.checksOk')} tone="success" />}
      {!clean && item.verification && item.verification.verdict !== 'supported' && <Badge label={verdictLabel(item.verification.verdict)} tone={VERDICT_TONE[item.verification.verdict]} />}
      {unlocated && <Badge label={t('org.source.notConfirmed')} tone="danger" />}
      {(compact ? flags.slice(0, 2) : flags).map((f) => (
        <Badge key={f} label={flagLabel(f)} tone="warning" />
      ))}
      {compact && flags.length > 2 && <Badge label={`+${flags.length - 2}`} />}
      {!clean && !item.verification && flags.length === 0 && !unlocated && item.sources.length === 0 && <Badge label={t('org.item.origin.manual')} />}
    </View>
  );
}

export function SourceCell({ item }: { item: BankItem }) {
  const { t } = useTranslation();
  const s = item.sources[0];
  if (!s) return <CellText muted>{t('org.source.none')}</CellText>;
  return (
    <CellText muted lines={1}>
      {sourceLabel(s)}
    </CellText>
  );
}

export function QuestionTable({ orgId, items, queue, showCourse = true, showStatus = false, loading, emptyTitle, emptyHint, caption, footer }: QuestionTableProps) {
  const { t } = useTranslation();
  const columns: Column<BankItem>[] = [
    {
      key: 'question',
      title: t('org.ws.columns.question'),
      flex: 4,
      render: (it) => (
        <View style={{ gap: 2 }}>
          <CellText lines={2}>{it.stem}</CellText>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
            {[t(`org.type.${it.type}`), it.section].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ),
    },
    { key: 'topic', title: t('org.ws.columns.topic'), flex: 2, render: (it) => <CellText lines={2}>{it.topic}</CellText> },
    ...(showCourse ? [{ key: 'course', title: t('org.ws.columns.course'), flex: 2, render: (it: BankItem) => <CellText muted lines={2}>{it.documentTitle}</CellText> }] : []),
    ...(showStatus ? [{ key: 'status', title: t('org.ws.columns.status'), width: 110, render: (it: BankItem) => <Badge label={statusLabel(it.status)} tone={STATUS_TONE[it.status]} /> }] : []),
    { key: 'checks', title: t('org.ws.columns.checks'), flex: 2.5, render: (it) => <ChecksCell item={it} compact /> },
    { key: 'source', title: t('org.ws.columns.source'), width: 130, render: (it) => <SourceCell item={it} /> },
    { key: 'updated', title: t('org.ws.columns.updated'), width: 96, align: 'right', render: (it) => <CellText muted lines={1}>{formatDate(it.updatedAt)}</CellText> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={items}
      keyOf={(it) => it.id}
      rowLabel={(it) => it.stem}
      onRowPress={(it) => openQuestion(orgId, it.id, queue)}
      loading={loading}
      emptyTitle={emptyTitle}
      emptyHint={emptyHint}
      caption={caption}
      footer={footer}
      renderCard={(it) => (
        <View style={{ gap: space(2) }}>
          <CellText lines={3}>{it.stem}</CellText>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
            {[it.topic, showCourse ? it.documentTitle : null, t(`org.type.${it.type}`), it.sources[0] ? sourceLabel(it.sources[0]) : null].filter(Boolean).join(' · ')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1) }}>
            {showStatus && <Badge label={statusLabel(it.status)} tone={STATUS_TONE[it.status]} />}
            <ChecksCell item={it} compact />
          </View>
        </View>
      )}
    />
  );
}
