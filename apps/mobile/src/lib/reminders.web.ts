/** The web has no study reminders (notifications are an iOS/Android app feature). */
import type { ReminderSettings } from './reminders-core';
import { DEFAULT_REMINDER } from './reminders-core';

export const remindersSupported = false;
export const loadReminderSettings = async (): Promise<ReminderSettings> => DEFAULT_REMINDER;
export const requestReminderPermission = async (): Promise<'granted' | 'denied'> => 'denied';
export const saveReminderSettings = async (_next: ReminderSettings, _previous: ReminderSettings): Promise<'ok' | 'denied'> => 'denied';
export const openNotificationSettings = () => {};
export const syncReminders = async (): Promise<void> => {};
export const useReminderTaps = (_enabled: boolean) => {};
export const clearReminders = async (): Promise<void> => {};
