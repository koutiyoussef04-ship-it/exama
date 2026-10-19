/**
 * Course-upload diagnostics: every way an upload can fail maps to one coarse category (compatible with the original values), the
 * picker and request-preparation failures are told apart from network failures, each failure has an actionable message in all four
 * languages, cancelling is not a failure, and the admin "Recent events" cell shows only the allow-listed diagnostic properties.
 * Categories carry no file name, path, error text or content.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import { eventDetails } from '../src/admin/event-details';
import { clientFailureMessageKey, PickerError, uploadFailureReason } from '../src/lib/upload-failure';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const api = (status: number, code?: string) => Object.assign(new Error('boom'), { status, code });

test('every failure maps to one category; the original values keep their meaning', () => {
  // Original values (existing events and dashboards): unchanged.
  assert.equal(uploadFailureReason(api(0, 'network')), 'network');
  assert.equal(uploadFailureReason(api(0)), 'network');
  assert.equal(uploadFailureReason(api(413, 'file_too_large')), 'too_large');
  assert.equal(uploadFailureReason(api(413)), 'too_large', 'an edge 413 has no JSON code');
  assert.equal(uploadFailureReason(api(415, 'not_pdf')), 'not_pdf');
  assert.equal(uploadFailureReason(api(415, 'ppt_legacy')), 'not_pdf', 'every unsupported type is not_pdf');
  assert.equal(uploadFailureReason(api(500)), 'server');
  assert.equal(uploadFailureReason(api(503, 'server_error')), 'server');
  assert.equal(uploadFailureReason(new Error('anything else')), 'unknown');
  assert.equal(uploadFailureReason(undefined), 'unknown');
  assert.equal(uploadFailureReason(api(400, 'invalid_request')), 'unknown');
  // New categories: where it failed.
  assert.equal(uploadFailureReason(new PickerError()), 'picker');
  assert.equal(uploadFailureReason(api(0, 'request_failed')), 'request');
  assert.equal(uploadFailureReason(api(0, 'app_misconfigured')), 'request');
  assert.equal(uploadFailureReason(api(400, 'file_missing')), 'request', 'the request reached the server without the file');
  assert.equal(uploadFailureReason(api(401, 'session_expired')), 'auth');
  assert.equal(uploadFailureReason(api(403, 'forbidden')), 'auth');
  assert.equal(uploadFailureReason(api(403, 'email_not_verified')), 'not_verified');
  assert.equal(uploadFailureReason(api(402, 'limit_reached')), 'limit');
  assert.equal(uploadFailureReason(api(429, 'too_many_requests')), 'rate_limited');
});

test('a picker failure and a request-preparation failure are told apart from a network failure, and carry no detail', () => {
  const picker = new PickerError();
  assert.equal(picker.message, 'file picker failed', 'a fixed message: no path or file name');
  assert.notEqual(uploadFailureReason(picker), uploadFailureReason(api(0, 'network')));
  assert.notEqual(uploadFailureReason(api(0, 'request_failed')), uploadFailureReason(api(0, 'network')));
  // The categories are the only thing sent: none can hold free text.
  const all = new Set([new PickerError(), api(0), api(0, 'request_failed'), api(401), api(403, 'email_not_verified'), api(402), api(413), api(415), api(429), api(500), new Error('x')].map(uploadFailureReason));
  assert.deepEqual([...all].sort(), ['auth', 'limit', 'network', 'not_pdf', 'not_verified', 'picker', 'rate_limited', 'request', 'server', 'too_large', 'unknown']);
});

test('failures with no server response get their own actionable message; everything else keeps its code-based message', () => {
  assert.equal(clientFailureMessageKey(new PickerError()), 'errors.picker');
  assert.equal(clientFailureMessageKey(api(0, 'request_failed')), 'errors.request');
  assert.equal(clientFailureMessageKey(api(0, 'network')), null, 'a real network failure keeps "check your internet connection"');
  assert.equal(clientFailureMessageKey(api(413, 'file_too_large')), null);
  assert.equal(clientFailureMessageKey(new Error('x')), null);
  const errors = src('lib/errors.ts');
  assert.match(errors, /const clientKey = clientFailureMessageKey\(err\);\s*if \(clientKey\) return t\(clientKey\);/, 'errorMessage asks first');
});

test('the new messages exist in all four languages, say what to do, and are not copies of the English', () => {
  for (const [lang, L] of Object.entries({ en, es, fr, ar })) {
    for (const key of ['picker', 'request'] as const) {
      const text = L.errors[key];
      assert.ok(typeof text === 'string' && text.length > 30, `${lang}.errors.${key}`);
      if (lang !== 'en') assert.notEqual(text, en.errors[key], `${lang}.errors.${key} is translated`);
    }
  }
  assert.match(ar.errors.picker, /[\u0600-\u06FF]/);
  assert.match(ar.errors.request, /[\u0600-\u06FF]/);
  assert.match(en.errors.picker, /try again/i);
  assert.match(en.errors.request, /try again|update the app/i);
  // The other categories already have translated, actionable messages (auth, verification, limits, rate limit, size, type, server).
  for (const L of [en, es, fr, ar]) for (const code of ['unauthenticated', 'session_expired', 'email_not_verified', 'too_many_requests', 'file_too_large', 'not_pdf', 'ppt_legacy', 'server_error'] as const) assert.ok(L.errors.codes[code], code);
});

test('the course upload tags picker failures, keeps cancelling silent, and reports a failed preparation as request_failed', () => {
  const courses = src('lib/courses.ts');
  assert.match(courses, /try \{\s*res = await DocumentPicker\.getDocumentAsync\([^)]*\);\s*\} catch \(err\) \{[\s\S]*?throw new PickerError\(\);/);
  assert.match(courses, /if \(res\.canceled\) return null;/, 'cancelling is not an error');
  assert.ok(courses.indexOf('if (res.canceled) return null;') < courses.indexOf("track('upload_started'"), 'no event for a cancel');
  assert.match(courses, /if \(!a\) throw new PickerError\(\);/, 'a picker that returns no file is a picker failure');
  assert.match(courses, /track\('upload_failed', \{ platform, failure_reason: uploadFailureReason\(err\) \}\)/);
  const apiSrc = src('lib/api.ts');
  assert.match(apiSrc, /throw new ApiError\(0, 'Could not prepare the file for upload', 'request_failed'\)/, 'a fixed message: the original may contain a path');
  assert.doesNotMatch(courses + apiSrc.slice(apiSrc.indexOf('uploadDocument:'), apiSrc.indexOf('// Billing')), /file\.name\s*[,)]\s*\}?\s*\)\s*;?\s*\n?.*track|track\([^)]*(name|uri)/, 'no file name or path goes into an event');
  assert.match(src('lib/analytics.ts'), /export \{ uploadFailureReason \} from '\.\/upload-failure'/, 'existing imports keep working');
});

test('admin Recent events: the Details cell shows platform, failure_reason and file size only', () => {
  assert.equal(eventDetails({ platform: 'web', failure_reason: 'request' }), 'platform: web, failure_reason: request');
  assert.equal(eventDetails({ platform: 'ios', file_size_kb: 812 }), 'platform: ios, file_size_kb: 812');
  assert.equal(eventDetails({ platform: 'android', authenticated: true, app_language: 'en', time_zone: 'America/Los_Angeles', document_id: 'x' }), 'platform: android', 'anything else is not shown');
  assert.equal(eventDetails({ failure_reason: 'x'.repeat(200) }).length, 'failure_reason: '.length + 40, 'long values are cut');
  assert.equal(eventDetails({ failure_reason: { nested: 'object' } as unknown as string }), '', 'only plain values');
  assert.equal(eventDetails({}), '');
  assert.equal(eventDetails(null), '');
  const screen = src('admin/AdminScreen.tsx');
  assert.match(screen, /columns=\{\['Event', 'Source', 'When', 'Details'\]\} rows=\{d\.recentEvents\.map\(\(e\) => \[[^\]]*eventDetails\(e\.properties\)\]\)\}/);
});
