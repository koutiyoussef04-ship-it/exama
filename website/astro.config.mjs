import { defineConfig } from 'astro/config';

// Static site: no server, no client-side framework. Deployed to https://exama.app.
// The product itself (https://app.exama.app) is a separate deployment of apps/mobile.
export default defineConfig({
  site: 'https://exama.app',
  output: 'static',
  trailingSlash: 'ignore',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
  vite: {
    // Pin this site's own tsconfig. Without it, Vite 8 (rolldown) can walk up from some files to the
    // monorepo's ROOT tsconfig.json — which extends "expo/tsconfig.base", not installed here — and the
    // build fails with "Tsconfig not found expo/tsconfig.base". Keeps the site independent of the app.
    tsconfig: './tsconfig.json',
  },
});
