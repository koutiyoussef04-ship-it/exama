/** Pure formatting helpers for course materials (no React Native imports — unit-tested). */
import type { MaterialStatus } from '@study/shared';

/** 1:05:09 / 12:04 — digits only, so it reads the same in every language. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Translation key for a material status line. */
export const statusKey = (s: MaterialStatus | 'uploading') =>
  (
    ({
      uploading: 'materials.statusUploading',
      processing: 'materials.statusProcessing',
      transcribing: 'materials.statusTranscribing',
      analyzing: 'materials.statusAnalyzing',
      ready: 'materials.statusReady',
      failed: 'materials.statusFailed',
    }) as const
  )[s];
