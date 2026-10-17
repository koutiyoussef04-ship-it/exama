/**
 * Study reminders are emails now (sent by the server, see reminders-core.ts). Older versions of the
 * iOS/Android app scheduled local notifications; this cancels any that are still pending, once per
 * launch, so students don't get both. No notification permission is asked for any more.
 */
import * as Notifications from 'expo-notifications';
import { LEGACY_REMINDER_ID_PREFIX } from './reminders-core';

export async function clearLegacyReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter((n) => n.identifier.startsWith(LEGACY_REMINDER_ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch {
    // Nothing scheduled, or notifications unavailable: nothing to clean up.
  }
}
