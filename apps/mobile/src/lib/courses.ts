/**
 * Starting a new course from a PDF or PowerPoint: used by the home screen's first upload and by
 * "Add material" → New course. The server checks the real format and the plan's limits.
 */
import type { Entitlement } from '@study/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { platform, track, uploadFailureReason } from './analytics';
import { api } from './api';
import { handleLimitError, openPaywall } from './billing';
import { limitMessage } from './errors';
import { log } from './log';
import { usePreferences } from './preferences';

/** Friendly pre-check (the server enforces the real limit): at the course cap, open the paywall instead of the picker. */
export function courseCapReached(e: Entitlement | undefined): boolean {
  if (!e || e.limits.courses === null || e.usage.courses < e.limits.courses) return false;
  openPaywall('limit_courses', limitMessage({ error: '', code: 'limit_reached', feature: 'courses', limit: e.limits.courses, used: e.usage.courses, tier: e.tier }));
  return true;
}

/** Picks a PDF/PowerPoint (`types`: both, or just one), uploads it as a new course and opens the course. */
export function useCourseUpload(onOpen: (id: string) => void = (id) => router.push({ pathname: '/documents/[id]', params: { id } })) {
  const qc = useQueryClient();
  const { aiLanguage } = usePreferences();
  return useMutation({
    mutationFn: async (types: string[]) => {
      const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
      if (res.canceled) return null;
      const a = res.assets[0];
      track('upload_started', { platform, file_size_kb: a.size ? Math.round(a.size / 1024) : undefined });
      return api.uploadDocument({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file }, aiLanguage);
    },
    onError: (err) => {
      log.error('[upload] failed:', err);
      track('upload_failed', { platform, failure_reason: uploadFailureReason(err) });
      handleLimitError(err); // plan limit → paywall
    },
    onSuccess: (doc) => {
      if (!doc) return;
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['entitlement'] });
      onOpen(doc.id);
    },
  });
}
