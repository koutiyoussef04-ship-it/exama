/**
 * Course materials in the app: picking a file, uploading it (streamed, with progress), and polling
 * the server while it is processed. The server decides everything (format, length, limits).
 */
import type { CourseMaterial, MaterialKind, MaterialStatus } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Platform } from 'react-native';
import i18n from '@/i18n';
import { platform, track } from './analytics';
import { api, ApiError, type PickedFile } from './api';
import { handleLimitError } from './billing';
import { optionKind, pickWith, type MaterialOption, type Pickers } from './material-options';
import { usePreferences } from './preferences';
export { formatDuration, statusKey } from './material-format';

export const ACTIVE_STATUSES: MaterialStatus[] = ['processing', 'transcribing', 'analyzing'];
export const isActive = (m: Pick<CourseMaterial, 'status'>) => ACTIVE_STATUSES.includes(m.status);

/** Course materials, refreshed every 3 s while any of them is still being processed. */
export const useMaterials = (documentId: string, enabled = true) =>
  useQuery({
    queryKey: ['materials', documentId],
    queryFn: () => api.listMaterials(documentId),
    enabled,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 3000 : false),
  });

/**
 * Opens the right system picker for one kind of material. null = cancelled.
 *   PDF / PowerPoint / lecture audio → the document picker (Files), restricted to PDF, PPTX or MP3/M4A/WAV.
 *   Lecture video on iOS/Android    → the Photos / Gallery video library, videos only (no permission
 *                                      prompt: iOS PHPicker / Android Photo Picker).
 *   Lecture video on the web        → a file input restricted to MP4/MOV.
 * Every picker returns a local copy (`file://` in the app's cache on iOS/Android), which the upload
 * streams to the API — the same endpoint, progress and server-side checks for every kind.
 */
export function pickMaterial(option: MaterialOption): Promise<(PickedFile & { size?: number }) | null> {
  return pickWith(NATIVE_PICKERS, option, Platform.OS, i18n.t('materials.untitled_video'));
}
const NATIVE_PICKERS: Pickers = {
  launchImageLibraryAsync: (o) =>
    ImagePicker.launchImageLibraryAsync({ ...o, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current }),
  getDocumentAsync: (o) => DocumentPicker.getDocumentAsync(o),
};

/** Coarse, non-identifying category for a failed material upload (analytics). */
export function materialFailureReason(err: unknown): 'network' | 'too_large' | 'unsupported_format' | 'too_long' | 'limit' | 'server' | 'unknown' {
  if (!(err instanceof ApiError)) return 'unknown';
  if (err.status === 0) return 'network';
  if (err.status === 413) return 'too_large';
  if (err.status === 415 || err.code === 'media_unreadable' || err.code === 'media_no_audio') return 'unsupported_format';
  if (err.status === 402) return (err.body as { feature?: string } | undefined)?.feature === 'media_length' ? 'too_long' : 'limit';
  if (err.status >= 500) return 'server';
  return 'unknown';
}


export type UploadingMaterial = { documentId: string; kind: MaterialKind; name: string; fraction: number };

/**
 * Adds one material to an existing course: file picker → streamed upload with progress. Used by the
 * course screen and the home screen's "Add material" (`entry`, for analytics). A plan limit (402)
 * opens the paywall — for Free's used-up lecture, the Student upgrade.
 */
export function useMaterialUpload(entry: 'course' | 'home') {
  const qc = useQueryClient();
  const { aiLanguage } = usePreferences();
  const [uploading, setUploading] = useState<UploadingMaterial | null>(null);
  const mutation = useMutation({
    mutationFn: async ({ documentId, option }: { documentId: string; option: MaterialOption }) => {
      // The picker opens first, inside the tap (the web only opens it from a user gesture).
      const file = await pickMaterial(option);
      if (!file) return null;
      const kind = optionKind(option);
      track('material_upload_started', { platform, document_id: documentId, kind, entry, file_size_kb: file.size ? Math.round(file.size / 1024) : undefined });
      setUploading({ documentId, kind, name: file.name, fraction: 0 });
      return api.uploadMaterial(documentId, file, aiLanguage, (fraction) => setUploading((u) => (u ? { ...u, fraction } : u)));
    },
    onError: (err, { documentId, option }) => {
      track('material_upload_failed', { platform, document_id: documentId, kind: optionKind(option), failure_reason: materialFailureReason(err) });
      handleLimitError(err);
    },
    onSettled: () => setUploading(null),
    onSuccess: (m, { documentId }) => {
      if (!m) return;
      void qc.invalidateQueries({ queryKey: ['materials', documentId] });
      void qc.invalidateQueries({ queryKey: ['entitlement'] });
    },
  });
  return { ...mutation, uploading };
}
