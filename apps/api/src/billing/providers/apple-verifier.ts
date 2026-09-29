/**
 * Verifies Apple-signed StoreKit 2 data (JWS) with Apple's official App Store Server Library.
 *
 * Every signed transaction, renewal info and App Store Server Notification V2 carries its
 * certificate chain in the JWS header (x5c). `SignedDataVerifier` checks that:
 *   - the chain leads to one of Apple's root certificates (certs/apple, public — not secrets),
 *   - the leaf/intermediate carry Apple's App Store receipt-signing OIDs,
 *   - the certificates are valid (and, with online checks, not revoked — OCSP to Apple),
 *   - the ES256 signature matches, and
 *   - the data is for our bundle id (and, in Production, our App Apple ID) and environment.
 * Only then is anything decoded and trusted. Xcode / LocalTesting data is never accepted (the
 * library skips signature checks for those environments, so we never create such a verifier).
 *
 * Sandbox data (TestFlight, App Review, sandbox testers) is accepted when APPLE_ALLOW_SANDBOX is on
 * (the default — App Review buys in the sandbox) and recorded as `environment: sandbox`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Environment, SignedDataVerifier, VerificationException, VerificationStatus } from '@apple/app-store-server-library';
import { HttpError } from '../../lib/errors.js';
import type { AppleNotification, AppleRenewalInfo, AppleTransaction, AppleVerifier } from './apple.js';

export type AppleVerifierOptions = {
  /** DER (.cer) or PEM root certificates to trust — Apple's in production, a test CA in tests. */
  rootCertificates: Buffer[];
  bundleId: string;
  /** The app's numeric Apple ID (App Store Connect → App Information). Required for Production data. */
  appAppleId?: number;
  /** Accept Sandbox data (TestFlight / App Review / sandbox testers). */
  allowSandbox: boolean;
  /** OCSP revocation checks against Apple, and certificate dates checked against now. */
  onlineChecks: boolean;
};

/** Loads every .cer / .der / .pem file in a directory (Apple's root certificates). */
export function loadRootCertificates(dir: string): Buffer[] {
  return readdirSync(dir)
    .filter((f) => /\.(cer|der|pem)$/i.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f)));
}

type Env = 'Production' | 'Sandbox';

/** Reads the (not yet trusted) `environment` claim so the matching verifier can check the JWS. */
function claimedEnvironment(jws: string, pick: (payload: Record<string, unknown>) => unknown): string | undefined {
  try {
    const part = jws.split('.')[1];
    if (!part) return undefined;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
    const env = pick(payload);
    return typeof env === 'string' ? env : undefined;
  } catch {
    return undefined;
  }
}

const invalid = (detail?: string) =>
  new HttpError(400, `The App Store purchase could not be verified${detail ? ` (${detail})` : ''}.`, 'invalid_purchase');

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v) throw invalid(`missing ${field}`);
  return v;
}
const optNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function createAppleVerifier(opts: AppleVerifierOptions): AppleVerifier {
  if (!opts.rootCertificates.length) throw new Error('Apple verification needs at least one root certificate.');
  const verifiers: Partial<Record<Env, SignedDataVerifier>> = {};
  if (opts.appAppleId !== undefined) {
    verifiers.Production = new SignedDataVerifier(opts.rootCertificates, opts.onlineChecks, Environment.PRODUCTION, opts.bundleId, opts.appAppleId);
  }
  if (opts.allowSandbox) {
    verifiers.Sandbox = new SignedDataVerifier(opts.rootCertificates, opts.onlineChecks, Environment.SANDBOX, opts.bundleId);
  }

  function verifierFor(env: string | undefined): SignedDataVerifier {
    const v = env === 'Production' || env === 'Sandbox' ? verifiers[env] : undefined;
    if (!v) {
      // Xcode / LocalTesting data is unsigned; Sandbox may be switched off; Production needs the App Apple ID.
      throw new HttpError(400, `App Store data from the "${env ?? 'unknown'}" environment is not accepted by this server.`, 'invalid_purchase');
    }
    return v;
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof VerificationException) {
        const status = VerificationStatus[err.status] ?? String(err.status);
        console.warn(`[apple] verification failed: ${status}`);
        throw invalid();
      }
      throw err; // OCSP network trouble etc. → 5xx, the app can retry
    }
  }

  return {
    verifyTransaction: (jws) =>
      run(async () => {
        const env = claimedEnvironment(jws, (p) => p.environment);
        const t = await verifierFor(env).verifyAndDecodeTransaction(jws);
        const tx: AppleTransaction = {
          bundleId: requireString(t.bundleId, 'bundleId'),
          productId: requireString(t.productId, 'productId'),
          transactionId: requireString(t.transactionId, 'transactionId'),
          originalTransactionId: requireString(t.originalTransactionId, 'originalTransactionId'),
          purchaseDate: optNumber(t.purchaseDate) ?? Date.now(),
          expiresDate: optNumber(t.expiresDate),
          offerType: optNumber(t.offerType),
          offerDiscountType: t.offerDiscountType as AppleTransaction['offerDiscountType'],
          revocationDate: optNumber(t.revocationDate),
          appAccountToken: typeof t.appAccountToken === 'string' ? t.appAccountToken : undefined,
          environment: env as Env,
        };
        return tx;
      }),

    verifyRenewalInfo: (jws) =>
      run(async () => {
        const r = await verifierFor(claimedEnvironment(jws, (p) => p.environment)).verifyAndDecodeRenewalInfo(jws);
        const info: AppleRenewalInfo = {
          originalTransactionId: requireString(r.originalTransactionId, 'originalTransactionId'),
          autoRenewStatus: r.autoRenewStatus === 1 ? 1 : 0,
          autoRenewProductId: typeof r.autoRenewProductId === 'string' ? r.autoRenewProductId : undefined,
          gracePeriodExpiresDate: optNumber(r.gracePeriodExpiresDate),
        };
        return info;
      }),

    verifyNotification: (jws) =>
      run(async () => {
        const env = claimedEnvironment(jws, (p) => (p.data as { environment?: unknown } | undefined)?.environment ?? (p.summary as { environment?: unknown } | undefined)?.environment);
        const n = await verifierFor(env).verifyAndDecodeNotification(jws);
        const notification: AppleNotification = {
          notificationType: requireString(n.notificationType, 'notificationType'),
          subtype: typeof n.subtype === 'string' ? n.subtype : undefined,
          notificationUUID: requireString(n.notificationUUID, 'notificationUUID'),
          data: n.data
            ? {
                bundleId: n.data.bundleId,
                environment: typeof n.data.environment === 'string' ? n.data.environment : undefined,
                signedTransactionInfo: n.data.signedTransactionInfo,
                signedRenewalInfo: n.data.signedRenewalInfo,
              }
            : undefined,
        };
        return notification;
      }),
  };
}
