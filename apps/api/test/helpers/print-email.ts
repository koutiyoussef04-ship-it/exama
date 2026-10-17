// Used by config.test.ts: loads config in a child process and prints the email-verification settings (never secrets).
import { config } from '../../src/config.js';
console.log(JSON.stringify({ provider: config.EMAIL_PROVIDER, webAppUrl: config.WEB_APP_URL ?? null, required: config.EMAIL_VERIFICATION_REQUIRED, graceHours: config.EMAIL_VERIFICATION_GRACE_HOURS }));
