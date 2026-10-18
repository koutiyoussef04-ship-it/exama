/**
 * When the app reports `app_opened` because the session's sign-in state changed (pure, so it can be tested).
 * Sent: once at launch (when the session has been restored), and again when the student signs in or signs up
 * during the session — so the device time zone (used for the daily study email's local send time) is linked
 * to the account even when the app was opened signed out. Not sent while the session is still loading
 * (`null`), on sign-out or when nothing changed.
 */
export type AppOpenedState = { launched: boolean; wasAuthenticated: boolean | null };

export const INITIAL_APP_OPENED_STATE: AppOpenedState = { launched: false, wasAuthenticated: null };

export function appOpenedOnAuthChange(state: AppOpenedState, authenticated: boolean | null): { send: boolean; state: AppOpenedState } {
  if (authenticated === null) return { send: false, state };
  const signedIn = state.launched && authenticated && state.wasAuthenticated === false;
  return { send: !state.launched || signedIn, state: { launched: true, wasAuthenticated: authenticated } };
}
