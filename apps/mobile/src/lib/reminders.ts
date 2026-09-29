/**
 * Daily study reminders on iOS/Android: local notifications (no push server). Settings live on the
 * device; `syncReminders` rebuilds the next week of reminders from the student's plans whenever the
 * app opens or a plan changes. See reminders-core.ts for what gets a reminder (never pointless ones).
 * The web has no reminders (reminders.web.ts).
 */
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import i18n from '@/i18n';
import { platform, track } from './analytics';
import { api } from './api';
import { buildReminders, parseReminderSettings, REMINDER_ID_PREFIX, type ReminderCourse, type ReminderKind, type ReminderSettings, type ReminderText } from './reminders-core';
import { kv } from './storage';

export const remindersSupported = Platform.OS === 'ios' || Platform.OS === 'android';
const SETTINGS_KEY = 'study_reminder';
const CHANNEL = 'study-reminders';

// Shown while the app is open too (as a banner), without sound or badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export const loadReminderSettings = async (): Promise<ReminderSettings> => parseReminderSettings(await kv.get(SETTINGS_KEY));

async function ensureChannel() {
  // Android 8+: notifications need a channel; Android 13+ only shows the permission prompt once one exists.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: i18n.t('reminders.channel'), importance: Notifications.AndroidImportance.DEFAULT });
  }
}

/** Asks for notification permission (only when the student turns reminders on). */
export async function requestReminderPermission(): Promise<'granted' | 'denied'> {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (!current.canAskAgain) return 'denied';
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return asked.granted || asked.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ? 'granted' : 'denied';
}

/** Saves new settings (asking for permission when turning reminders on) and reschedules. */
export async function saveReminderSettings(next: ReminderSettings, previous: ReminderSettings): Promise<'ok' | 'denied'> {
  if (next.enabled && !previous.enabled && (await requestReminderPermission()) === 'denied') return 'denied';
  await kv.set(SETTINGS_KEY, JSON.stringify(next));
  if (next.enabled !== previous.enabled) track(next.enabled ? 'reminder_enabled' : 'reminder_disabled', next.enabled ? { platform, hour: next.hour } : { platform });
  else if (next.enabled && (next.hour !== previous.hour || next.minute !== previous.minute)) track('reminder_time_changed', { platform, hour: next.hour });
  await syncReminders();
  return 'ok';
}

export const openNotificationSettings = () => void Linking.openSettings();

const text: ReminderText = (kind, v) => ({
  title: i18n.t(`reminders.${kind}Title`, v),
  body: kind === 'plan' || kind === 'exam_soon'
    ? v.more > 0
      ? i18n.t(`reminders.${kind}BodyMore`, { ...v, count: v.more })
      : i18n.t(`reminders.${kind}Body`, v)
    : i18n.t('reminders.practiceBody', v),
});

let syncing: Promise<void> | null = null;
/** Rebuilds this device's study reminders for the next week. Safe to call often. */
export function syncReminders(): Promise<void> {
  syncing ??= doSync()
    .catch((err) => console.warn('[reminders] could not schedule:', err instanceof Error ? err.message : err))
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

async function doSync() {
  const settings = await loadReminderSettings();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(REMINDER_ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  if (!settings.enabled || !(await Notifications.getPermissionsAsync()).granted) return;

  const docs = (await api.listDocuments()).filter((d) => d.status === 'ready').slice(0, 20);
  const courses: ReminderCourse[] = await Promise.all(
    docs.map(async (d) => {
      const [plan, progress] = await Promise.all([api.getStudyPlan(d.id).catch(() => null), api.getProgress(d.id).catch(() => null)]);
      return {
        documentId: d.id,
        title: d.title,
        plan,
        hasUnfinished: !!progress?.exams.some((e) => e.status === 'in_progress'),
        hasWeakTopics: !!progress?.weakTopics.length,
      };
    }),
  );
  await ensureChannel();
  for (const r of buildReminders({ settings, courses, now: new Date(), text })) {
    // One identifier per day: rescheduling replaces, so never more than one reminder a day.
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: r.data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: CHANNEL },
    });
  }
}

/** Signed out: remove this device's reminders (they are about the signed-out account's plans). */
export async function clearReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(REMINDER_ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/** Opens the plan/course a reminder is about (also when the tap launched the app). */
export function useReminderTaps(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || !response.notification.request.identifier.startsWith(REMINDER_ID_PREFIX)) return;
      const data = response.notification.request.content.data as { url?: string; kind?: ReminderKind } | undefined;
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      if (!data?.url) return;
      track('reminder_opened', { platform, kind: data.kind ?? 'plan' });
      router.push(data.url as Href);
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [enabled]);
}
