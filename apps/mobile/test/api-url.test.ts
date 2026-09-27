/** API base URL selection: development conveniences never leak into release builds. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalOrPrivateHost, parseAppEnv, resolveApiUrl, validateReleaseApiUrl } from '../src/config/api-url.js';

test('development: env override, else the Expo LAN host, else localhost', () => {
  assert.deepEqual(resolveApiUrl({ appEnv: 'development', isDevBundle: true, envUrl: 'http://192.168.1.23:4000/' }), { ok: true, url: 'http://192.168.1.23:4000' });
  assert.deepEqual(resolveApiUrl({ appEnv: 'development', isDevBundle: true, hostUri: '192.168.1.50:8081' }), { ok: true, url: 'http://192.168.1.50:4000' });
  assert.deepEqual(resolveApiUrl({ appEnv: 'development', isDevBundle: true, hostUri: 'abc.exp.direct:80' }), { ok: true, url: 'http://localhost:4000' });
  assert.deepEqual(resolveApiUrl({ appEnv: 'development', isDevBundle: true }), { ok: true, url: 'http://localhost:4000' });
});

test('preview/production: only a public https URL is accepted', () => {
  for (const appEnv of ['preview', 'production'] as const) {
    assert.deepEqual(resolveApiUrl({ appEnv, isDevBundle: false, envUrl: 'https://api.exama.app/' }), { ok: true, url: 'https://api.exama.app' });
    assert.equal(resolveApiUrl({ appEnv, isDevBundle: false }).ok, false, 'missing URL');
    assert.equal(resolveApiUrl({ appEnv, isDevBundle: false, hostUri: '192.168.1.50:8081' }).ok, false, 'never derived from the dev server');
    for (const bad of ['http://api.exama.app', 'https://localhost:4000', 'https://127.0.0.1', 'https://192.168.1.23:4000', 'https://10.0.0.5', 'https://172.20.1.1', 'https://mypc.local', 'not a url']) {
      assert.equal(resolveApiUrl({ appEnv, isDevBundle: false, envUrl: bad }).ok, false, bad);
    }
  }
});

test('a release JS bundle is treated as release even if APP_ENV was left at development', () => {
  assert.equal(resolveApiUrl({ appEnv: 'development', isDevBundle: false, hostUri: '192.168.1.50:8081' }).ok, false);
  assert.equal(resolveApiUrl({ appEnv: 'development', isDevBundle: false, envUrl: 'https://api.exama.app' }).ok, true);
});

test('helpers', () => {
  assert.equal(parseAppEnv('production'), 'production');
  assert.equal(parseAppEnv('staging'), 'development');
  assert.equal(isLocalOrPrivateHost('172.32.0.1'), false);
  assert.equal(isLocalOrPrivateHost('api.example.com'), false);
  assert.match((validateReleaseApiUrl('http://x.com') as { error: string }).error, /https/);
});
