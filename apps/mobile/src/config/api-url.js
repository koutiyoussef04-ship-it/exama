// @ts-check
/**
 * API base URL selection — pure logic, shared by app.config.ts (build time) and the app (runtime).
 * Plain CommonJS so Expo's config loader can require it (types: api-url.d.ts).
 *
 *  development  EXPO_PUBLIC_API_URL if set, else the PC that serves the app in Expo LAN mode
 *               (port 4000), else localhost. http is fine.
 *  preview /    EXPO_PUBLIC_API_URL is REQUIRED, must be https and must not point to localhost or a
 *  production   private network address. Otherwise the build fails (app.config.ts) and the app shows
 *               a configuration error instead of silently calling a developer machine.
 */
'use strict';

const APP_ENVS = ['development', 'preview', 'production'];
const DEV_API_PORT = 4000;

/** @param {unknown} value */
function parseAppEnv(value) {
  return APP_ENVS.includes(/** @type {string} */ (value)) ? /** @type {'development'|'preview'|'production'} */ (value) : 'development';
}

/** localhost, loopback, link-local, RFC 1918 private ranges, *.local mDNS names, Expo tunnels. @param {string} host */
function isLocalOrPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0' || h === '::1') return true;
  if (h.endsWith('.exp.direct')) return true;
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return false;
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** Validates a URL for a store (preview/production) build. @param {string | undefined} raw */
function validateReleaseApiUrl(raw) {
  const value = raw ? raw.trim() : '';
  if (!value) return { ok: false, error: 'EXPO_PUBLIC_API_URL is not set. Release builds need the production HTTPS API URL.' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: `EXPO_PUBLIC_API_URL is not a valid URL: "${value}"` };
  }
  if (url.protocol !== 'https:') return { ok: false, error: `EXPO_PUBLIC_API_URL must use https:// in release builds (got "${value}").` };
  if (isLocalOrPrivateHost(url.hostname)) {
    return { ok: false, error: `EXPO_PUBLIC_API_URL points to a local/private address ("${url.hostname}"), which phones outside your network can't reach.` };
  }
  return { ok: true, url: value.replace(/\/+$/, '') };
}

/**
 * @param {{ appEnv: 'development'|'preview'|'production', envUrl?: string, hostUri?: string | null, isDevBundle: boolean }} input
 */
function resolveApiUrl(input) {
  // A JS bundle built for release (__DEV__ false) is always treated as a release build.
  const release = input.appEnv !== 'development' || !input.isDevBundle;
  if (release) return validateReleaseApiUrl(input.envUrl);
  const fromEnv = input.envUrl ? input.envUrl.trim() : '';
  if (fromEnv) return { ok: true, url: fromEnv.replace(/\/+$/, '') };
  const host = input.hostUri ? input.hostUri.split(':')[0] : '';
  if (host && !host.endsWith('.exp.direct')) return { ok: true, url: `http://${host}:${DEV_API_PORT}` };
  return { ok: true, url: `http://localhost:${DEV_API_PORT}` };
}

module.exports = { APP_ENVS, DEV_API_PORT, parseAppEnv, isLocalOrPrivateHost, validateReleaseApiUrl, resolveApiUrl };
