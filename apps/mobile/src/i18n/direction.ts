/**
 * Layout direction (LTR/RTL). On iOS/Android the direction is fixed when the app starts, so
 * switching between Arabic and a left-to-right language stores the new direction and restarts the
 * app. On web the <html dir> attribute is updated live.
 */
import { reloadAppAsync } from 'expo';
import { I18nManager, Platform } from 'react-native';
import { kv } from '@/lib/storage';
import { log } from '@/lib/log';
import { isRtlLanguage, type Language } from './languages';

const RELOAD_KEY = 'rtl_reload';

export const isNativeRtl = () => I18nManager.isRTL;

function setWebDirection(lang: Language) {
  const doc = globalThis.document;
  const el = doc?.documentElement;
  if (!doc || !el) return;
  el.dir = isRtlLanguage(lang) ? 'rtl' : 'ltr';
  el.lang = lang;
  // React Navigation doesn't mirror its back arrow on web; do it with CSS.
  if (!doc.getElementById('exama-rtl')) {
    const style = doc.createElement('style');
    style.id = 'exama-rtl';
    style.textContent = 'html[dir="rtl"] img[src*="back-icon"] { transform: scaleX(-1); }';
    doc.head.appendChild(style);
  }
}

/** Applies the direction; returns true when a native restart was triggered. */
export async function applyDirection(lang: Language, opts: { reload: boolean }): Promise<boolean> {
  if (Platform.OS === 'web') {
    setWebDirection(lang);
    return false;
  }
  const rtl = isRtlLanguage(lang);
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  I18nManager.swapLeftAndRightInRTL(true);
  if (I18nManager.isRTL === rtl || !opts.reload) return false;

  // Guard against a reload loop if the platform ignores forceRTL (e.g. RTL unsupported in a build).
  const last = await kv.get(RELOAD_KEY);
  const [target, at] = (last ?? '').split('@');
  if (target === String(rtl) && Date.now() - Number(at) < 15_000) {
    log.warn('[i18n] layout direction did not change after a restart; continuing without restarting again');
    return false;
  }
  await kv.set(RELOAD_KEY, `${rtl}@${Date.now()}`);
  await reloadAppAsync('Layout direction changed');
  return true;
}
