/**
 * "Add material" from the course list: the same selector as the course screen (PDF · PowerPoint ·
 * Audio · Video), then where it goes — a new course (PDF/PowerPoint) or one of your courses. The
 * file picker opens on that second tap (the web only opens it from a tap). The API checks the file
 * and the plan; a used-up free lecture or a locked plan opens the Student paywall.
 */
import type { DocumentSummary } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { MaterialKindList, UploadingRow } from '@/components/materials';
import { Body, Card, Chevron, colors, ErrorText, Screen, SectionLabel, space, WorkingCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useEntitlement } from '@/lib/billing';
import { courseCapReached, useCourseUpload } from '@/lib/courses';
import { isLectureOption, OPTION_PICKER_TYPES, type MaterialOption } from '@/lib/material-options';
import { useMaterialUpload } from '@/lib/materials';

/** Close this sheet and open the course, where the new material's progress is shown. */
function openCourse(id: string) {
  if (router.canDismiss()) router.dismiss();
  router.push({ pathname: '/documents/[id]', params: { id } });
}

export default function AddMaterial() {
  const { t } = useTranslation();
  const e = useEntitlement().data;
  const docs = useQuery({ queryKey: ['documents'], queryFn: api.listDocuments });
  const [option, setOption] = useState<MaterialOption | null>(null);
  const upload = useMaterialUpload('home');
  const course = useCourseUpload(openCourse);
  const busy = upload.isPending || course.isPending;

  const all = docs.data ?? [];
  // Materials are added to a course the server has finished reading.
  const ready = all.filter((d) => d.status === 'ready');
  const lecture = !!option && isLectureOption(option);

  const addTo = (d: DocumentSummary) => {
    if (!option) return;
    upload.mutate({ documentId: d.id, option }, { onSuccess: (m) => m && openCourse(d.id) });
  };
  const newCourse = () => {
    if (!option || courseCapReached(e)) return;
    course.mutate(OPTION_PICKER_TYPES[option]);
  };
  const pages = (d: DocumentSummary) => (d.pageCount != null ? t(d.format === 'pptx' ? 'home.slides' : 'home.pages', { count: d.pageCount }) : '');

  return (
    <Screen>
      <Body muted>{t('addMaterial.intro')}</Body>

      <View style={{ gap: space(2) }}>
        <SectionLabel>{t('materials.addTitle')}</SectionLabel>
        <MaterialKindList selected={option} onChoose={setOption} disabled={busy} />
      </View>

      {!!option && !busy && (
        <View style={{ gap: space(2) }}>
          <SectionLabel>{t('addMaterial.where')}</SectionLabel>
          {!lecture && <TargetRow icon="➕" title={t('addMaterial.newCourse')} detail={t('addMaterial.newCourseHint')} onPress={newCourse} />}
          {ready.map((d) => (
            <TargetRow key={d.id} icon="📚" title={d.title} detail={pages(d)} onPress={() => addTo(d)} />
          ))}
          {/* Lectures need a course to add to: the first one starts from a PDF or PowerPoint. */}
          {lecture && ready.length === 0 && (
            <Body muted style={{ fontSize: 14 }}>{all.some((d) => d.status === 'processing') ? t('addMaterial.courseProcessing') : t('addMaterial.needCourse')}</Body>
          )}
        </View>
      )}

      {upload.uploading && (
        <Card>
          <UploadingRow {...upload.uploading} />
        </Card>
      )}
      {course.isPending && <WorkingCard title={t('home.uploading')} />}
      <ErrorText error={upload.error ?? course.error} />
    </Screen>
  );
}

function TargetRow({ icon, title, detail, onPress }: { icon: string; title: string; detail: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${title}, ${detail}` : title} onPress={onPress}>
      {({ pressed }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), opacity: pressed ? 0.7 : 1 }}>
          <Text style={{ fontSize: 20 }} accessibilityElementsHidden importantForAccessibility="no">
            {icon}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }} numberOfLines={2}>
              {title}
            </Text>
            {!!detail && <Text style={{ color: colors.muted, fontSize: 13 }}>{detail}</Text>}
          </View>
          <Chevron />
        </Card>
      )}
    </Pressable>
  );
}
