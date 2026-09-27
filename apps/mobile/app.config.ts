/**
 * Expo app configuration for Exama — the single place for store identifiers, versions and
 * build-environment switches. See docs/release/eas-build.md.
 *
 * Environment (set per EAS build profile in eas.json, or in your shell for local runs):
 *   APP_ENV              development | preview | production   (default: development)
 *   EXPO_PUBLIC_API_URL  API base URL. Required (https, public host) for preview/production.
 *   EAS_PROJECT_ID       from `eas init` (optional until you link the project)
 *   EXPO_PUBLIC_SUPPORT_EMAIL, EXPO_PUBLIC_PRIVACY_URL, EXPO_PUBLIC_TERMS_URL,
 *   EXPO_PUBLIC_COMPANY_NAME, EXPO_PUBLIC_COMPANY_ADDRESS   legal/support details shown in the app
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withAndroidManifest, withGradleProperties, type ConfigPlugin } from 'expo/config-plugins';
import { parseAppEnv, validateReleaseApiUrl } from './src/config/api-url';

const APP_ENV = parseAppEnv(process.env.APP_ENV);

/** Store identifiers. Change here only (App Store Connect / Play Console must match). */
export const BUNDLE_ID = 'com.exama.app';
/**
 * Marketing version shown in the stores (bump for each App Store release: 1.0.0 → 1.0.1 / 1.1.0).
 * Build numbers (iOS buildNumber / Android versionCode) are managed by EAS ("appVersionSource":
 * "remote" + "autoIncrement" in eas.json), so they can never go backwards or collide.
 */
export const VERSION = '1.0.0';

const BRAND = { navy: '#15173F', primary: '#5B4CF5', background: '#F6F7FB' };

if (APP_ENV !== 'development') {
  // Fail the build instead of shipping an app that calls localhost or plain http.
  const api = validateReleaseApiUrl(process.env.EXPO_PUBLIC_API_URL);
  if (!api.ok) throw new Error(`[app.config] APP_ENV=${APP_ENV}: ${api.error}`);
}

/**
 * Development builds only: allow plain-http requests to the API on your LAN (http://192.168.x.x:4000)
 * on Android, which blocks cleartext traffic by default. Preview/production builds never get this —
 * they require an https API URL (checked above).
 */
const withDevCleartext: ConfigPlugin = (cfg) =>
  withAndroidManifest(cfg, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });

/**
 * Android store for expo-iap: always Google Play. (Without a pin, a local debug build picks the store
 * of the connected device, e.g. Meta Horizon on a Quest.)
 */
const withGooglePlayBilling: ConfigPlugin = (cfg) =>
  withGradleProperties(cfg, (mod) => {
    mod.modResults = mod.modResults.filter((p) => !(p.type === 'property' && p.key === 'openiapStore'));
    mod.modResults.push({ type: 'property', key: 'openiapStore', value: 'play' });
    return mod;
  });

const LOCALES = ['en', 'es', 'fr', 'ar'];

export default ({ config }: ConfigContext): ExpoConfig => {
  const base: ExpoConfig = {
    ...config,
    name: 'Exama',
    slug: 'exama',
    scheme: 'exama',
    version: VERSION,
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    userInterfaceStyle: 'light',
    backgroundColor: BRAND.background,
    ios: {
      bundleIdentifier: BUNDLE_ID,
      // iPhone-first. Set to true only after testing iPad layouts and preparing iPad screenshots.
      supportsTablet: false,
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false, // HTTPS only (exempt) — skips the export-compliance prompt
        CFBundleDevelopmentRegion: 'en',
        CFBundleAllowMixedLocalizations: true,
      },
      // App-level privacy manifest. Expo modules ship their own manifests for the APIs they use.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
        NSPrivacyAccessedAPITypes: [
          // Language/RTL preferences and React Native's own settings live in UserDefaults.
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        ],
      },
    },
    android: {
      package: BUNDLE_ID,
      adaptiveIcon: {
        backgroundColor: BRAND.navy,
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // The app only needs the network and Google Play Billing. PDFs, PowerPoints and audio come from the
      // system document picker (Storage Access Framework), lecture videos from the Android Photo Picker:
      // no storage or media permission.
      permissions: ['android.permission.INTERNET', 'com.android.vending.BILLING'],
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
      ],
    },
    web: {
      favicon: './assets/images/favicon.png',
      name: 'Exama',
      shortName: 'Exama',
      description: 'Turn your course material into a personal AI tutor.',
      themeColor: BRAND.primary,
      backgroundColor: BRAND.background,
      output: 'single',
    },
    plugins: [
      'expo-router',
      // No biometrics are used: don't add a Face ID usage description.
      ['expo-secure-store', { faceIDPermission: false }],
      ['expo-localization', { supportsRTL: true, supportedLocales: { ios: LOCALES, android: LOCALES } }],
      ['expo-splash-screen', { image: './assets/images/splash-icon.png', imageWidth: 180, resizeMode: 'contain', backgroundColor: BRAND.navy }],
      // In-app subscriptions: StoreKit 2 on iOS, Google Play Billing on Android (src/lib/store/native.ts).
      // Native code — needs a development build (`eas build --profile development`), not Expo Go.
      'expo-iap',
      // Lecture videos come from Photos (iOS PHPicker) / the Gallery (Android Photo Picker): neither
      // asks for a permission. The app never uses the camera or microphone: no usage strings, and
      // CAMERA / RECORD_AUDIO stay blocked on Android. iOS still needs the photo-library purpose string.
      [
        'expo-image-picker',
        {
          photosPermission: 'Exama opens your photo library only when you choose a lecture video to add to a course.',
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    experiments: { typedRoutes: true },
    extra: {
      appEnv: APP_ENV,
      // Lets Expo Go honour right-to-left layouts (dev builds get it from the expo-localization plugin).
      supportsRTL: true,
      ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
    },
  };
  const withStore = withGooglePlayBilling(base);
  return APP_ENV === 'development' ? withDevCleartext(withStore) : withStore;
};
