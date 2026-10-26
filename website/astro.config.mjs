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
  // Old or guessed addresses of the organizations pages → the real ones. A static build emits a redirect page for each
  // (<meta http-equiv="refresh"> + canonical) so visitors and crawlers land on the right page; the host's own redirect
  // rule (a real 301) is set in the Render dashboard for exama-marketing (see the runbook) and is the preferred route.
  redirects: {
    '/fr/for-organizations': '/fr/pour-les-organismes',
    '/fr/for-organizations/demo': '/fr/pour-les-organismes/demo',
    '/fr/pour-les-organisations': '/fr/pour-les-organismes',
    '/fr/pour-les-organisations/demo': '/fr/pour-les-organismes/demo',
    '/es/for-organizations': '/es/para-organizaciones',
    '/es/for-organizations/demo': '/es/para-organizaciones/demo',
  },
  vite: {
    // Pin this site's own tsconfig. Without it, Vite 8 (rolldown) can walk up from some files to the
    // monorepo's ROOT tsconfig.json — which extends "expo/tsconfig.base", not installed here — and the
    // build fails with "Tsconfig not found expo/tsconfig.base". Keeps the site independent of the app.
    tsconfig: './tsconfig.json',
  },
});
