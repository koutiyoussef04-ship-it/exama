/**
 * "Course materials" on the course screen: the course PDF/PowerPoint plus added lectures and
 * documents, their processing status, and "Add material". `MaterialKindList` is THE material
 * selector (PDF · PowerPoint · Audio · Video); the home screen's "Add material" uses it too.
 * Everything added feeds the same course — exams, practice and the study plan use it once it's
 * ready. Audio/video: Student/Pro/trial, plus Free's one lecture per account; otherwise they're
 * shown locked and open the Student paywall instead of the file picker.
 */
import type { CourseMaterial, MaterialKind } from '@study/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { openPaywall, remaining, useEntitlement } from '@/lib/billing';
import { isLectureOption, lectureAccess, MATERIAL_OPTIONS, pickerSource, type MaterialOption } from '@/lib/material-options';
import { formatDuration, isActive, statusKey, useMaterials, useMaterialUpload, type UploadingMaterial } from '@/lib/materials';
import { Body, Button, Card, Chevron, colors, ErrorText, ProgressBar, SectionLabel, space, TextButton } from './ui';

const ICON: Record<MaterialKind, string> = { pdf: '📄', audio: '🎧', video: '🎬' };
const OPTION_ICON: Record<MaterialOption, string> = { pdf: '📄', pptx: '📊', audio: '🎧', video: '🎬' };

export function useMaterialTitle() {
  const { t } = useTranslation();
  return (m: Pick<CourseMaterial, 'title' | 'kind' | 'primary' | 'format'>) =>
    m.primary ? (m.format === 'pptx' ? t('materials.coursePptx') : t('materials.coursePdf')) : m.title || t(`materials.untitled_${m.kind}`);
}

/** "PDF" / "PowerPoint" for documents, "Audio" / "Video" for lectures. */
export function useMaterialKindLabel() {
  const { t } = useTranslation();
  return (m: Pick<CourseMaterial, 'kind' | 'format'>) =>
    m.kind === 'pdf' ? (m.format === 'pptx' ? t('materials.format_pptx') : t('materials.format_pdf')) : t(`materials.kind_${m.kind}`);
}

/**
 * The material selector: PDF, PowerPoint, Audio, Video. Calls `onChoose` for what the plan allows
 * (call the file picker from it directly — the web only opens it inside the tap). Audio/video that
 * the plan doesn't include (Basic) or Free's used-up lecture open the Student paywall instead.
 */
export function MaterialKindList({ onChoose, disabled, selected }: { onChoose: (o: MaterialOption) => void; disabled?: boolean; selected?: MaterialOption | null }) {
  const { t } = useTranslation();
  const e = useEntitlement().data;
  const access = lectureAccess(e);
  const lockedHint = access === 'free_used' ? t('materials.freeLectureUsed') : t('materials.lockedKind');
  const locked = (o: MaterialOption) => isLectureOption(o) && access !== 'available';

  const choose = (o: MaterialOption) => {
    if (!locked(o)) return onChoose(o);
    if (access === 'free_used') openPaywall('free_lecture_used', t('limits.free_media_uploads'));
    else openPaywall('locked_lectures', t('paywall.lockedLectures'));
  };
  const lectureHint = (() => {
    if (!e || access !== 'available') return null;
    if (e.lectureAllowance === 'once') return t('materials.lectureOnce', { length: e.limits.maxMediaMinutesPerFile });
    const left = remaining(e.limits.mediaMinutesPerMonth, e.usage.mediaMinutesThisMonth);
    if (left === null) return null;
    return t(e.usagePeriod === 'trial' ? 'materials.minutesLeftTrial' : 'materials.minutesLeftMonth', { left, length: e.limits.maxMediaMinutesPerFile });
  })();

  return (
    <View style={{ gap: space(2) }} accessibilityRole="radiogroup">
      {MATERIAL_OPTIONS.map((o) => {
        // Says where the file comes from: Files, or the Photos (iOS) / Gallery (Android) video library.
        const source = pickerSource(o, Platform.OS);
        const hint = locked(o) ? lockedHint : source === 'files' ? t(`materials.optionHint_${o}`) : t(`materials.optionHint_video_${source}`);
        const isSelected = selected === o;
        return (
          <Pressable
            key={o}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected, disabled }}
            accessibilityLabel={`${t(`materials.option_${o}`)}. ${hint}`}
            onPress={() => choose(o)}
            disabled={disabled}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space(3),
              padding: space(3),
              borderRadius: 12,
              borderWidth: isSelected ? 2 : 1,
              borderColor: isSelected ? colors.primary : colors.border,
              backgroundColor: colors.card,
              opacity: pressed || disabled ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 22 }} accessibilityElementsHidden importantForAccessibility="no">
              {locked(o) ? '🔒' : OPTION_ICON[o]}
            </Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: locked(o) ? colors.muted : colors.text, fontSize: 16, fontWeight: '600' }}>{t(`materials.option_${o}`)}</Text>
              <Text style={{ color: locked(o) ? colors.primary : colors.muted, fontSize: 13 }}>{hint}</Text>
            </View>
            <Chevron />
          </Pressable>
        );
      })}
      {!!lectureHint && <Body muted style={{ fontSize: 13 }}>{lectureHint}</Body>}
    </View>
  );
}

export function MaterialsCard({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const materials = useMaterials(documentId);
  const [choosing, setChoosing] = useState(false);
  const upload = useMaterialUpload('course');
  const uploading = upload.uploading?.documentId === documentId ? upload.uploading : null;

  // When a material finishes, the course gains topics: refresh everything that shows them.
  const ready = materials.data?.filter((m) => m.status === 'ready').length ?? 0;
  const lastReady = useRef<number | null>(null);
  useEffect(() => {
    if (lastReady.current !== null && ready !== lastReady.current) {
      for (const key of [['document', documentId], ['progress', documentId], ['study-plan', documentId], ['entitlement']]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    }
    lastReady.current = ready;
  }, [ready, documentId, qc]);
  // Close the selector once a file is chosen (the upload row shows the progress).
  useEffect(() => {
    if (uploading) setChoosing(false);
  }, [uploading]);

  const list = materials.data ?? [];

  return (
    <Card style={{ gap: space(3) }}>
      <SectionLabel>{t('materials.title')}</SectionLabel>
      {list.length <= 1 && !uploading && <Body muted style={{ fontSize: 14, lineHeight: 20 }}>{t('materials.intro')}</Body>}

      <View>
        {list.map((m, i) => (
          <MaterialRow key={m.id} material={m} last={i === list.length - 1 && !uploading} />
        ))}
        {uploading && <UploadingRow {...uploading} />}
      </View>

      {choosing ? (
        <View style={{ gap: space(2) }}>
          <Body style={{ fontWeight: '600' }}>{t('materials.addTitle')}</Body>
          <MaterialKindList onChoose={(option) => upload.mutate({ documentId, option })} disabled={upload.isPending} />
          <TextButton title={t('common.cancel')} tone="muted" onPress={() => setChoosing(false)} />
        </View>
      ) : (
        <Button variant="secondary" title={t('materials.add')} onPress={() => setChoosing(true)} disabled={!!uploading} />
      )}
      <ErrorText error={upload.error} />
    </Card>
  );
}

export function UploadingRow({ kind, name, fraction }: Pick<UploadingMaterial, 'kind' | 'name' | 'fraction'>) {
  const { t } = useTranslation();
  const percent = Math.round(fraction * 100);
  return (
    <View style={{ gap: space(2), paddingVertical: space(3) }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <Text style={{ fontSize: 20 }} accessibilityElementsHidden importantForAccessibility="no">
          {ICON[kind]}
        </Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
            {name}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{t('materials.uploadingDetail', { percent })}</Text>
        </View>
        <ActivityIndicator color={colors.primary} />
      </View>
      <ProgressBar value={fraction} color={colors.primary} />
    </View>
  );
}

function MaterialRow({ material: m, last }: { material: CourseMaterial; last: boolean }) {
  const { t } = useTranslation();
  const title = useMaterialTitle()(m);
  const kindLabel = useMaterialKindLabel()(m);
  const active = isActive(m);
  const meta = [
    kindLabel,
    m.durationSeconds ? formatDuration(m.durationSeconds) : m.pageCount ? t(m.format === 'pptx' ? 'home.slides' : 'home.pages', { count: m.pageCount }) : null,
    m.status === 'ready' ? null : t(statusKey(m.status)),
  ]
    .filter(Boolean)
    .join(' · ');
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(3),
        minHeight: 56,
        paddingVertical: space(2),
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 20 }} accessibilityElementsHidden importantForAccessibility="no">
        {ICON[m.kind]}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>
          {title}
        </Text>
        <Text style={{ color: m.status === 'failed' ? colors.danger : colors.muted, fontSize: 13 }}>{meta}</Text>
      </View>
      {active ? <ActivityIndicator color={colors.primary} /> : m.primary ? null : <Chevron />}
    </View>
  );
  if (m.primary) return <View accessibilityLabel={t('materials.a11yItem', { title, meta })}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('materials.a11yItem', { title, meta })}
      onPress={() => router.push({ pathname: '/materials/[id]', params: { id: m.id, documentId: m.documentId } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  );
}
