/**
 * app_opened links the device time zone to the account (used for the daily study email's local send time).
 * Regression, 2026-10-18: a student who opened the app signed out and signed up in the same session never
 * sent a signed-in app_opened, so the server had no time zone for the account and sent no email.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { appOpenedOnAuthChange, INITIAL_APP_OPENED_STATE, type AppOpenedState } from '../src/lib/app-opened';

/** Feeds a sequence of sign-in states (as the root layout sees them) and returns when app_opened is sent. */
function sends(sequence: (boolean | null)[]): boolean[] {
  let state: AppOpenedState = INITIAL_APP_OPENED_STATE;
  return sequence.map((auth) => {
    const next = appOpenedOnAuthChange(state, auth);
    state = next.state;
    return next.send;
  });
}

test('launch: sent once the session is restored, never while it is still loading', () => {
  assert.deepEqual(sends([null, true]), [false, true], 'signed in at launch');
  assert.deepEqual(sends([null, false]), [false, true], 'signed out at launch');
});

test('sign-up or sign-in during the session: sent again, signed in (the production case)', () => {
  assert.deepEqual(sends([null, false, true]), [false, true, true]);
  // A loading state between the two (the auth provider refreshing) does not hide the change.
  assert.deepEqual(sends([null, false, null, true]), [false, true, false, true]);
  // Sign out, then sign in to another account: sent for the new account too.
  assert.deepEqual(sends([null, true, false, true]), [false, true, false, true]);
});

test('no extra events: sign-out and unchanged states send nothing', () => {
  assert.deepEqual(sends([null, true, true, true]), [false, true, false, false]);
  assert.deepEqual(sends([null, true, false, false]), [false, true, false, false]);
});

test('the root layout uses it, and every app_opened carries the device time zone', () => {
  const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /const next = appOpenedOnAuthChange\(opened\.current, authenticated\);/);
  assert.match(layout, /if \(next\.send\) send\(\);/);
  assert.match(layout, /track\('app_opened', \{[^}]*\.\.\.deviceZone\(\) \}\)/);
  assert.match(layout, /useAppOpenedTracking\(isLoading \? null : !!user\)/);
});
