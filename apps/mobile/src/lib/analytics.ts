/**
 * Client-side product analytics: only events the API can't observe itself
 * (app opened, upload started/failed, course opened, exam/practice started).
 * Everything else is recorded server-side. Best-effort: never throws, never blocks the UI.
 * Properties are ids/counts/categories only — see packages/shared/src/analytics.ts.
 */
import type { ClientEventName, ClientEventProperties } from '@study/shared';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, ApiError } from './api';

const ANON_KEY = 'analytics_anon_id';
let anonId: string | null = null;
const sentOnce = new Set<string>();

export const platform = (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'unknown') as
  | 'ios'
  | 'android'
  | 'web'
  | 'unknown';

/** Random v4-style id; identifies the install, not the person. */
function randomId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function getAnonymousId(): Promise<string> {
  if (anonId) return anonId;
  try {
    const stored = Platform.OS === 'web' ? globalThis.localStorage?.getItem(ANON_KEY) : await SecureStore.getItemAsync(ANON_KEY);
    anonId = stored || randomId();
    if (!stored) {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(ANON_KEY, anonId);
      else await SecureStore.setItemAsync(ANON_KEY, anonId);
    }
  } catch {
    anonId ??= randomId();
  }
  return anonId;
}

export function track<N extends ClientEventName>(name: N, properties: ClientEventProperties<N>): void {
  void (async () => {
    try {
      const events = [{ name, properties }] as Parameters<typeof api.sendEvents>[0]['events'];
      await api.sendEvents({ anonymousId: await getAnonymousId(), events });
    } catch (err) {
      if (__DEV__) console.warn(`[analytics] ${name} not sent:`, err instanceof Error ? err.message : err);
    }
  })();
}

/** Tracks at most once per app session for the given key (e.g. one exam_started per exam). */
export function trackOnce<N extends ClientEventName>(key: string, name: N, properties: ClientEventProperties<N>): void {
  if (sentOnce.has(key)) return;
  sentOnce.add(key);
  track(name, properties);
}

/** Coarse, non-identifying category for a failed upload. */
export function uploadFailureReason(err: unknown): 'network' | 'too_large' | 'not_pdf' | 'server' | 'unknown' {
  if (!(err instanceof ApiError)) return 'unknown';
  if (err.status === 0) return 'network';
  if (err.status === 413) return 'too_large';
  if (err.status === 415) return 'not_pdf';
  if (err.status >= 500) return 'server';
  return 'unknown';
}
