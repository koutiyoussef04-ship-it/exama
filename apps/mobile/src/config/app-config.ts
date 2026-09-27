/**
 * Runtime app configuration (public values only — never secrets).
 * Values come from app.config.ts (`extra`) and EXPO_PUBLIC_* variables inlined at build time.
 */
import Constants from 'expo-constants';
import { parseAppEnv, resolveApiUrl } from './api-url';

export const appEnv = parseAppEnv(Constants.expoConfig?.extra?.appEnv);
export const appVersion = Constants.expoConfig?.version ?? '1.0.0';

/** Production-like build: hides every development/test control. */
export const isReleaseBuild = appEnv !== 'development' || !__DEV__;

export const apiUrlResult = resolveApiUrl({
  appEnv,
  envUrl: process.env.EXPO_PUBLIC_API_URL,
  hostUri: Constants.expoConfig?.hostUri,
  isDevBundle: __DEV__,
});

const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Business details for the legal and support screens. Missing values show as [placeholders]. */
export const legalConfig = {
  company: opt(process.env.EXPO_PUBLIC_COMPANY_NAME),
  address: opt(process.env.EXPO_PUBLIC_COMPANY_ADDRESS),
  supportEmail: opt(process.env.EXPO_PUBLIC_SUPPORT_EMAIL),
  privacyUrl: opt(process.env.EXPO_PUBLIC_PRIVACY_URL),
  termsUrl: opt(process.env.EXPO_PUBLIC_TERMS_URL),
};
