/**
 * Course materials in the app: duration formatting, status labels and a translated message for
 * every error/limit the materials API can return, in all four languages.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { formatDuration, statusKey } from '../src/lib/material-format';
import { AUDIO_PICKER_TYPES, isFreeLectureLimit, isLectureOption, lectureAccess, MATERIAL_OPTIONS, OPTION_PICKER_TYPES, optionKind, pickerFor, pickerSource, pickWith, videoAssetToFile, type Pickers } from '../src/lib/material-options';

type Dict = { [k: string]: string | Dict };
const get = (d: Dict, path: string) => path.split('.').reduce<string | Dict | undefined>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);
const LOCALES = { en, es, fr, ar } as unknown as Record<string, Dict>;

// Every code the materials API can return (apps/api/src/services/materials, lib/media-probe, routes).
const SERVER_CODES = [
  'file_too_large', 'file_missing', 'unsupported_format', 'media_unreadable', 'media_no_audio', 'media_no_speech', 'media_unavailable',
  'media_expired', 'transcription_failed', 'transcription_timeout', 'material_no_topics', 'too_many_materials', 'too_many_processing',
  'too_many_requests', 'retry_limit', 'material_not_failed', 'material_not_retryable', 'document_processing', 'not_found',
  'pdf_unreadable', 'pdf_no_text', 'processing_failed', 'ai_unavailable', 'ai_rate_limited', 'ai_bad_output',
];
const LIMIT_KEYS = [
  'media_uploads', 'media_minutes', 'media_length',
  'trial_media_uploads', 'trial_media_minutes', 'trial_media_length',
  'free_media_uploads', 'free_media_minutes', 'free_media_length', // Free's one lecture per account
];

test('duration: digits only (same in every language), hours when needed', () => {
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(720), '12:00');
  assert.equal(formatDuration(3909), '1:05:09');
  assert.equal(formatDuration(null), '');
  assert.equal(formatDuration(0), '');
});

for (const [lang, dict] of Object.entries(LOCALES)) {
  test(`${lang}: every materials status, error code and lecture limit has a translation`, () => {
    for (const s of ['uploading', 'processing', 'transcribing', 'analyzing', 'ready', 'failed'] as const) {
      assert.equal(typeof get(dict, statusKey(s)), 'string', `${lang} ${statusKey(s)}`);
    }
    for (const code of SERVER_CODES) assert.equal(typeof get(dict, `errors.codes.${code}`), 'string', `${lang} errors.codes.${code}`);
    for (const k of LIMIT_KEYS) assert.equal(typeof get(dict, `limits.${k}`), 'string', `${lang} limits.${k}`);
    // The selector's four options (course screen and home "Add material"), plus lecture texts.
    for (const o of ['pdf', 'pptx', 'audio', 'video']) {
      assert.equal(typeof get(dict, `materials.option_${o}`), 'string', `${lang} materials.option_${o}`);
      assert.equal(typeof get(dict, `materials.optionHint_${o}`), 'string', `${lang} materials.optionHint_${o}`);
    }
    // Where lecture videos come from on the phone: Photos (iOS), the gallery (Android).
    for (const k of ['optionHint_video_photos', 'optionHint_video_gallery']) assert.equal(typeof get(dict, `materials.${k}`), 'string', `${lang} materials.${k}`);
    for (const k of ['kind_audio', 'kind_video', 'step_transcribing', 'step_analyzing', 'step_adding', 'transcriptOnly', 'freeLectureUsed', 'lectureOnce']) {
      assert.equal(typeof get(dict, `materials.${k}`), 'string', `${lang} materials.${k}`);
    }
    // The file-size message is about any file now, not just PDFs.
    assert.ok(!/PDF/.test(get(dict, 'errors.codes.file_too_large') as string), `${lang}: file_too_large mentions PDF`);
  });
}

test('Arabic material texts are written in Arabic script (not left in English)', () => {
  // Format names (PDF, PowerPoint) stay Latin, as on the stores.
  const FORMAT_NAMES = new Set(['format_pdf', 'format_pptx', 'option_pdf', 'option_pptx']);
  const texts = Object.entries((ar as unknown as Dict).materials as Dict)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && !FORMAT_NAMES.has(e[0]))
    .map(([, v]) => v);
  const arabic = texts.filter((t) => /[؀-ۿ]/.test(t));
  assert.ok(arabic.length >= texts.length - 1, 'only placeholders may stay Latin');
});

test('material selector: PDF, PowerPoint, Audio, Video — a PowerPoint is a text document for the server', () => {
  assert.deepEqual([...MATERIAL_OPTIONS], ['pdf', 'pptx', 'audio', 'video']);
  assert.deepEqual(MATERIAL_OPTIONS.map(optionKind), ['pdf', 'pdf', 'audio', 'video']);
  assert.deepEqual(MATERIAL_OPTIONS.map(isLectureOption), [false, false, true, true]);
  assert.deepEqual(OPTION_PICKER_TYPES.pdf, ['application/pdf']);
  assert.deepEqual(OPTION_PICKER_TYPES.pptx, ['application/vnd.openxmlformats-officedocument.presentationml.presentation']);
  assert.ok(OPTION_PICKER_TYPES.audio.includes('audio/mpeg') && OPTION_PICKER_TYPES.video.includes('video/mp4'));
});

test('lecture access from the server entitlement: Free once (45 min), then the Student paywall; Basic locked', () => {
  const limits = (uploads: number | null, minutes: number | null) => ({ mediaUploadsPerMonth: uploads, mediaMinutesPerMonth: minutes }) as never;
  const usage = (uploads: number, minutes: number) => ({ mediaUploadsThisMonth: uploads, mediaMinutesThisMonth: minutes }) as never;
  const e = (allowance: 'none' | 'once' | 'trial' | 'monthly' | 'unlimited', lectures: boolean, l: never, u: never) =>
    ({ lectureAllowance: allowance, features: { lectures } as never, limits: l, usage: u });
  assert.equal(lectureAccess(undefined), 'available', 'not loaded: the server decides');
  assert.equal(lectureAccess(e('once', true, limits(1, 45), usage(0, 0))), 'available');
  assert.equal(lectureAccess(e('once', true, limits(1, 45), usage(1, 45))), 'free_used');
  assert.equal(lectureAccess(e('once', true, limits(1, 45), usage(1, 0))), 'free_used', 'a failed free lecture still counts (only a retry of it is allowed)');
  assert.equal(lectureAccess(e('none', false, limits(0, 0), usage(0, 0))), 'locked', 'Basic');
  // Monthly plans are never "free used": at their monthly limit the server's 402 opens the paywall.
  assert.equal(lectureAccess(e('monthly', true, limits(30, 300), usage(30, 300))), 'available');
  assert.equal(lectureAccess(e('unlimited', true, limits(null, null), usage(99, 9999))), 'available');
  assert.equal(lectureAccess({ features: { lectures: false } as never, limits: limits(1, 45), usage: usage(0, 0) }), 'locked', 'older API without lectureAllowance');
});

test('Free-plan lecture 402s are the "free lecture used" paywall; other tiers keep their own', () => {
  for (const feature of ['media_uploads', 'media_minutes', 'media_length'] as const) {
    assert.equal(isFreeLectureLimit({ feature, tier: 'free' }), true, feature);
    assert.equal(isFreeLectureLimit({ feature, tier: 'student' }), false);
    assert.equal(isFreeLectureLimit({ feature, tier: 'trial' }), false);
  }
  assert.equal(isFreeLectureLimit({ feature: 'courses', tier: 'free' }), false);
  assert.equal(isFreeLectureLimit({ feature: 'lectures', tier: 'basic' }), false);
});

/** Fake pickers that record how they were opened and answer with a given result. */
function fakePickers(media: Awaited<ReturnType<Pickers['launchImageLibraryAsync']>>, doc: Awaited<ReturnType<Pickers['getDocumentAsync']>>) {
  const calls: { picker: 'media' | 'document'; options: unknown }[] = [];
  const pickers: Pickers = {
    launchImageLibraryAsync: async (options) => (calls.push({ picker: 'media', options }), media),
    getDocumentAsync: async (options) => (calls.push({ picker: 'document', options }), doc),
  };
  return { pickers, calls };
}
const VIDEO_ONLY = { mediaTypes: ['videos'], allowsEditing: false, allowsMultipleSelection: false, preferredAssetRepresentationMode: 'current', shouldDownloadFromNetwork: true };
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

test('pickers per platform: video → Photos/Gallery video library on iOS and Android; PDF, PowerPoint, audio → document picker', () => {
  for (const os of ['ios', 'android'] as const) {
    assert.deepEqual(pickerFor('video', os), { picker: 'media' }, os);
    assert.deepEqual(pickerFor('pdf', os), { picker: 'document', types: ['application/pdf'] });
    assert.deepEqual(pickerFor('pptx', os), { picker: 'document', types: [PPTX] });
    assert.deepEqual(pickerFor('audio', os), { picker: 'document', types: AUDIO_PICKER_TYPES });
  }
  // The web has no photo library: a file input restricted to MP4/MOV.
  assert.deepEqual(pickerFor('video', 'web'), { picker: 'document', types: ['video/mp4', 'video/quicktime'] });
  assert.deepEqual(MATERIAL_OPTIONS.map((o) => pickerSource(o, 'ios')), ['files', 'files', 'files', 'photos']);
  assert.deepEqual(MATERIAL_OPTIONS.map((o) => pickerSource(o, 'android')), ['files', 'files', 'files', 'gallery']);
  assert.deepEqual(MATERIAL_OPTIONS.map((o) => pickerSource(o, 'web')), ['files', 'files', 'files', 'files']);
});

test('audio picker: MP3, M4A and WAV only (no AAC, OGG, FLAC, video or "any audio")', () => {
  for (const t of AUDIO_PICKER_TYPES) assert.match(t, /^audio\/(mpeg|mp3|mp4|x-m4a|m4a|mp4a-latm|wav|x-wav|wave|vnd\.wave)$/, t);
  for (const t of ['audio/*', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm', '*/*']) assert.ok(!AUDIO_PICKER_TYPES.includes(t), t);
  assert.ok(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav'].every((t) => AUDIO_PICKER_TYPES.includes(t)));
});

for (const os of ['ios', 'android'] as const) {
  test(`${os}: "Lecture video" opens the video library (videos only) and returns a streamable local copy`, async () => {
    const asset = os === 'ios'
      ? { uri: 'file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/1.mov', fileName: 'IMG_0042.MOV', mimeType: 'video/quicktime', fileSize: 52_428_800, type: 'video' }
      : { uri: 'file:///data/user/0/com.exama.app/cache/ImagePicker/2.mp4', fileName: 'lecture-week3.mp4', mimeType: 'video/mp4', fileSize: 10_485_760, type: 'video' };
    const { pickers, calls } = fakePickers({ canceled: false, assets: [asset] }, { canceled: true });
    const file = await pickWith(pickers, 'video', os, 'Lecture video');
    assert.deepEqual(calls, [{ picker: 'media', options: VIDEO_ONLY }], 'only the video library, never the document picker');
    assert.deepEqual(file, { uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType, size: asset.fileSize });
  });

  test(`${os}: PDF, PowerPoint and audio open the document picker restricted to their types`, async () => {
    for (const [option, types] of [['pdf', ['application/pdf']], ['pptx', [PPTX]], ['audio', AUDIO_PICKER_TYPES]] as const) {
      const picked = { uri: `file:///cache/DocumentPicker/x.${option}`, name: `notes.${option}`, mimeType: types[0], size: 2048 };
      const { pickers, calls } = fakePickers({ canceled: true }, { canceled: false, assets: [picked] });
      assert.deepEqual(await pickWith(pickers, option, os, 'Lecture video'), { ...picked, file: undefined });
      assert.deepEqual(calls, [{ picker: 'document', options: { type: types, copyToCacheDirectory: true, multiple: false } }], option);
    }
  });

  test(`${os}: cancelling either picker uploads nothing`, async () => {
    const { pickers } = fakePickers({ canceled: true, assets: null }, { canceled: true, assets: null });
    for (const o of MATERIAL_OPTIONS) assert.equal(await pickWith(pickers, o, os, 'Lecture video'), null, o);
  });
}

test('video library asset: name and type when the library gives none; photos are never uploaded as lectures', async () => {
  // iOS without full library access may give no file name; Android's copy is always *.mp4.
  assert.deepEqual(videoAssetToFile({ uri: 'file:///c/ImagePicker/ABC.mov', fileName: null, mimeType: null, fileSize: null }, 'Lecture video'),
    { uri: 'file:///c/ImagePicker/ABC.mov', name: 'Lecture video.mov', mimeType: 'video/quicktime' });
  assert.deepEqual(videoAssetToFile({ uri: 'file:///c/ImagePicker/1.mp4', fileName: undefined, mimeType: 'video/quicktime' }, 'Vidéo de cours').name, 'Vidéo de cours.mov');
  assert.equal(videoAssetToFile({ uri: 'file:///c/x', fileName: '  ' }, 'Lecture video').name, 'Lecture video.mp4');
  const { pickers } = fakePickers({ canceled: false, assets: [{ uri: 'file:///c/p.jpg', type: 'image' }] }, { canceled: true });
  assert.equal(await pickWith(pickers, 'video', 'android', 'Lecture video'), null);
});
