/**
 * Support contact: one email address, shown on the Support screen and opened with mailto:.
 * No ticket system and no extra service — the address is always visible and copyable, so it also
 * works on a device with no email app.
 */
export const SUPPORT_EMAIL = 'examaweb@gmail.com';

/** mailto: link for the Support screen. Only the subject is prefilled (no account or device details). */
export function supportMailto(subject: string, email: string = SUPPORT_EMAIL): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Copies text with the browser's Clipboard API (the web app). Resolves false where it is not available
 * (the native apps, which have no clipboard module — there the address is selectable instead) or refused.
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
  if (typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
