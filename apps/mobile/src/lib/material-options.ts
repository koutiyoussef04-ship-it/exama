/**
 * The four things a student can add — PDF, PowerPoint, Audio, Video — shared by the course screen
 * ("Course materials") and the home screen ("Add material"). Pure (no React Native), so it's unit
 * tested. Display only: the API decides what's allowed (GET /billing/status, 402 on upload).
 */
import { PDF_MIME, PPTX_MIME, type Entitlement, type LimitErrorBody, type MaterialKind } from '@study/shared';

export const MATERIAL_OPTIONS = ['pdf', 'pptx', 'audio', 'video'] as const;
export type MaterialOption = (typeof MATERIAL_OPTIONS)[number];

/** The server's material kind: a PowerPoint is a text document like a PDF (`kind: 'pdf'`, `format: 'pptx'`). */
export const optionKind = (o: MaterialOption): MaterialKind => (o === 'pptx' ? 'pdf' : o);
export const isLectureOption = (o: MaterialOption) => o === 'audio' || o === 'video';

/**
 * Lecture audio: only what the server can read — MP3, M4A (AAC in MP4) and WAV. Android file
 * providers label .m4a and .wav inconsistently, hence the aliases. (Mobile-only list: the server
 * still checks the real format from the file's bytes.)
 */
export const AUDIO_PICKER_TYPES = [
  'audio/mpeg', 'audio/mp3', // .mp3
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mp4a-latm', // .m4a
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', // .wav
];
/** Lecture video on the web (a file input): MP4 and MOV. iOS/Android use the Photos/Gallery video picker. */
export const VIDEO_FILE_TYPES = ['video/mp4', 'video/quicktime'];

/** Document-picker MIME types per option (the server still checks the real format from the bytes). */
export const OPTION_PICKER_TYPES: Record<MaterialOption, string[]> = {
  pdf: [PDF_MIME],
  pptx: [PPTX_MIME],
  audio: AUDIO_PICKER_TYPES,
  video: VIDEO_FILE_TYPES,
};

export type PickerPlatform = 'ios' | 'android' | 'web' | (string & {});
/**
 * Which system picker opens:
 *   media     → the Photos (iOS) / Gallery (Android) video library, videos only (expo-image-picker)
 *   document  → the Files / document picker restricted to `types` (expo-document-picker)
 */
export type PickerChoice = { picker: 'media' } | { picker: 'document'; types: string[] };
export function pickerFor(option: MaterialOption, os: PickerPlatform): PickerChoice {
  if (option === 'video' && (os === 'ios' || os === 'android')) return { picker: 'media' };
  return { picker: 'document', types: OPTION_PICKER_TYPES[option] };
}
/** Where the file comes from, for the option's hint ("From Photos", "From your gallery", "From your files"). */
export function pickerSource(option: MaterialOption, os: PickerPlatform): 'photos' | 'gallery' | 'files' {
  if (pickerFor(option, os).picker === 'document') return 'files';
  return os === 'ios' ? 'photos' : 'gallery';
}

/** The fields of an expo-image-picker asset we use (kept structural so this file stays pure). */
export type VideoAssetLike = { uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number | null; file?: File; type?: string | null };
const VIDEO_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
const VIDEO_MIME: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime' };
const extOf = (s: string | null | undefined) => /\.([a-z0-9]{2,4})(?:[?#].*)?$/i.exec(s ?? '')?.[1]?.toLowerCase();

/**
 * A picked Photos/Gallery video as the upload expects it (same shape as a document-picker file):
 * the copy the picker made in the app's cache (`file://…`, streamed by the upload — never read into
 * memory), a display name (the library may not give one: `fallbackName` + extension), a MIME type
 * (informational — the server sniffs the bytes) and the size for analytics.
 */
export function videoAssetToFile(a: VideoAssetLike, fallbackName: string): { uri: string; name: string; mimeType?: string; file?: File; size?: number } {
  const ext = extOf(a.fileName) ?? (a.mimeType ? VIDEO_EXT[a.mimeType] : undefined) ?? extOf(a.uri) ?? 'mp4';
  const mimeType = a.mimeType || VIDEO_MIME[ext] || undefined;
  const name = a.fileName?.trim() || `${fallbackName}.${ext}`;
  return { uri: a.uri, name, mimeType, ...(a.file ? { file: a.file } : {}), ...(a.fileSize ? { size: a.fileSize } : {}) };
}

/** The two system pickers, injected so the choice and the exact options are unit tested per platform. */
export type Pickers = {
  launchImageLibraryAsync: (o: {
    mediaTypes: ['videos'];
    allowsEditing: false;
    allowsMultipleSelection: false;
    preferredAssetRepresentationMode: 'current';
    shouldDownloadFromNetwork: true;
  }) => Promise<{ canceled: boolean; assets?: VideoAssetLike[] | null }>;
  getDocumentAsync: (o: { type: string[]; copyToCacheDirectory: true; multiple: false }) => Promise<{
    canceled: boolean;
    assets?: { uri: string; name: string; mimeType?: string; file?: File; size?: number }[] | null;
  }>;
};
export type PickedMaterialFile = { uri: string; name: string; mimeType?: string; file?: File; size?: number };

/** Opens the picker `pickerFor` chooses; null = cancelled (or a non-video from the library). */
export async function pickWith(pickers: Pickers, option: MaterialOption, os: PickerPlatform, videoFallbackName: string): Promise<PickedMaterialFile | null> {
  const choice = pickerFor(option, os);
  if (choice.picker === 'media') {
    const res = await pickers.launchImageLibraryAsync({
      mediaTypes: ['videos'], // videos only: no photos in the library view
      allowsEditing: false, // no trimming / re-encoding step
      allowsMultipleSelection: false,
      // iOS: the original file (no transcoding to H.264), downloaded from iCloud if it isn't on the phone.
      preferredAssetRepresentationMode: 'current',
      shouldDownloadFromNetwork: true,
    });
    const a = res.canceled ? null : res.assets?.[0];
    if (!a || (a.type && a.type !== 'video')) return null;
    return videoAssetToFile(a, videoFallbackName);
  }
  const res = await pickers.getDocumentAsync({ type: choice.types, copyToCacheDirectory: true, multiple: false });
  const a = res.canceled ? null : res.assets?.[0];
  if (!a) return null;
  return { uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file, size: a.size };
}

/**
 * Can audio/video be added right now?
 *   available  → pick a file (the server still checks minutes and length)
 *   locked     → not in this plan (Basic) → Student paywall
 *   free_used  → Free's one lecture per account is used → Student paywall
 */
export type LectureAccess = 'available' | 'locked' | 'free_used';
type EntitlementView = Pick<Entitlement, 'features' | 'limits' | 'usage'> & { lectureAllowance?: Entitlement['lectureAllowance'] };

export function lectureAccess(e: EntitlementView | undefined | null): LectureAccess {
  if (!e) return 'available'; // not loaded yet: let the server answer
  if (!e.features.lectures || e.lectureAllowance === 'none') return 'locked';
  if (e.lectureAllowance === 'once') {
    const { mediaUploadsPerMonth: uploads, mediaMinutesPerMonth: minutes } = e.limits;
    if ((uploads !== null && e.usage.mediaUploadsThisMonth >= uploads) || (minutes !== null && e.usage.mediaMinutesThisMonth >= minutes)) return 'free_used';
  }
  return 'available';
}

const LECTURE_LIMITS: readonly LimitErrorBody['feature'][] = ['media_uploads', 'media_minutes', 'media_length'];

/** A 402 about Free's one lecture (used, or too long for it): shown as the Student upgrade. */
export const isFreeLectureLimit = (body: Pick<LimitErrorBody, 'feature' | 'tier'>) => body.tier === 'free' && LECTURE_LIMITS.includes(body.feature);
