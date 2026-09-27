# Exama — brand assets

Identity: minimalist, student-focused, purple/blue gradient on deep navy; graduation cap over a document.
Colors used in the app (`apps/mobile/src/components/ui.tsx`, `app.config.ts`): primary `#5B4CF5`, navy `#15173F`, background `#F6F7FB`.

## Where the files go

The current files are **provisional**: they were cut out of the logo image you shared (1254×1254 JPEG-quality PNG with the wordmark). They work for development and TestFlight, but replace them with exports from the original vector/design file before the App Store release. Keep the same file names and sizes and no config change is needed.

| File (`apps/mobile/assets/…`) | Size | Requirements | Used for |
|---|---|---|---|
| `images/icon.png` | **1024×1024** PNG | square, **no transparency, no rounded corners** (iOS masks it), no text | iOS app icon + App Store icon |
| `images/android-icon-foreground.png` | 1024×1024 PNG | transparent background, symbol inside the central ~66% safe zone | Android adaptive icon (foreground) |
| `images/android-icon-background.png` | 1024×1024 PNG | solid/gradient navy, no transparency | Android adaptive icon (background) |
| `images/android-icon-monochrome.png` | 1024×1024 PNG | single-colour white symbol on transparent | Android 13+ themed icons |
| `images/splash-icon.png` | 1024×1024 PNG | transparent symbol (shown at 180 pt on navy `#15173F`) | launch screen |
| `images/favicon.png` | 48×48 PNG | | web build |
| `images/logo-mark.png` | 512×512 PNG | transparent symbol | sign-in screen |
| `brand/exama-logo.png` | original | the full logo you shared (reference only, not bundled) | — |

The "Exama" wordmark in the app is rendered as text (with the gradient "x" approximated by the primary colour), so it stays sharp and never needs translating.

## Still needed from you

- [ ] Final **1024×1024 app icon** (no alpha) exported from the source design.
- [ ] Transparent **symbol-only** export (for splash, Android foreground, sign-in) and a **white monochrome** version.
- [ ] App Store screenshots: 6.9" (1320×2868 or 1290×2796) — at least 3, ideally per language (en/es/fr/ar). Optional app preview video.
- [ ] Optional: the wordmark font name, if you want the in-app wordmark to match exactly.
