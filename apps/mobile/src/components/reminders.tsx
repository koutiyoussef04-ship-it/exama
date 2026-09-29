/**
 * Daily study reminder controls: the Account setting (on/off + time) and the one-time offer on the
 * study plan screen — the moment a reminder makes sense. Permission is asked only when the student
 * turns reminders on; if it's refused, everything else keeps working.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, Text, View } from 'react-native';
import { Body, Button, Card, colors, SectionLabel, space, TextButton } from '@/components/ui';
import { formatTime } from '@/lib/plan-dates';
import { loadReminderSettings, openNotificationSettings, remindersSupported, saveReminderSettings } from '@/lib/reminders';
import { DEFAULT_REMINDER, shiftTime, type ReminderSettings } from '@/lib/reminders-core';
import { kv } from '@/lib/storage';
import { useDateLocale } from './planner';

const hhmm = (s: Pick<ReminderSettings, 'hour' | 'minute'>) => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;

function useReminderSettings() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadReminderSettings().then(setSettings);
  }, []);
  const update = useCallback(
    async (next: ReminderSettings) => {
      if (!settings) return;
      setBusy(true);
      try {
        const result = await saveReminderSettings(next, settings);
        setDenied(result === 'denied');
        if (result === 'ok') setSettings(next);
      } finally {
        setBusy(false);
      }
    },
    [settings],
  );
  return { settings, denied, busy, update };
}

/** Account → Study reminders. */
export function ReminderSettingsCard() {
  const { t } = useTranslation();
  const locale = useDateLocale();
  const { settings, denied, busy, update } = useReminderSettings();

  if (!remindersSupported) {
    return (
      <Card style={{ gap: space(2) }}>
        <SectionLabel>{t('reminders.title')}</SectionLabel>
        <Body muted style={{ fontSize: 14 }}>{t('reminders.webOnly')}</Body>
      </Card>
    );
  }
  if (!settings) return null;
  return (
    <Card style={{ gap: space(3) }}>
      <SectionLabel>{t('reminders.title')}</SectionLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{t('reminders.daily')}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{t('reminders.hint')}</Text>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={(enabled) => void update({ ...settings, enabled })}
          disabled={busy}
          accessibilityLabel={t('reminders.daily')}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {settings.enabled && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) }}>
          <StepButton label={t('reminders.earlier')} onPress={() => void update({ ...settings, ...shiftTime(settings, -30) })} disabled={busy} />
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }} accessibilityLiveRegion="polite" accessibilityLabel={t('reminders.timeA11y', { time: formatTime(hhmm(settings), locale) })}>
            {formatTime(hhmm(settings), locale)}
          </Text>
          <StepButton label={t('reminders.later')} onPress={() => void update({ ...settings, ...shiftTime(settings, 30) })} disabled={busy} />
        </View>
      )}
      {denied && <DeniedNotice />}
    </Card>
  );
}

const OFFER_KEY = 'reminder_offer_dismissed';

/** On the study plan: "Want a daily reminder?" — once, until turned on or dismissed. */
export function ReminderOffer() {
  const { t } = useTranslation();
  const locale = useDateLocale();
  const { settings, denied, busy, update } = useReminderSettings();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    void kv.get(OFFER_KEY).then((v) => setDismissed(v === 'dismissed'));
  }, []);
  if (!remindersSupported || !settings || dismissed !== false || (settings.enabled && !denied)) return null;
  const time = formatTime(hhmm(DEFAULT_REMINDER), locale);
  return (
    <Card style={{ gap: space(2.5) }}>
      <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>{t('reminders.offerTitle')}</Text>
      <Body muted style={{ fontSize: 14 }}>{t('reminders.offerBody', { time })}</Body>
      {denied ? (
        <DeniedNotice />
      ) : (
        <Button title={t('reminders.offerCta', { time })} onPress={() => void update({ ...settings, enabled: true })} loading={busy} />
      )}
      <TextButton
        title={t('common.notNow')}
        tone="muted"
        onPress={() => {
          setDismissed(true);
          void kv.set(OFFER_KEY, 'dismissed');
        }}
      />
    </Card>
  );
}

function DeniedNotice() {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(1) }}>
      <Body style={{ color: colors.warning, fontSize: 14 }}>{t('reminders.denied')}</Body>
      <TextButton title={t('reminders.openSettings')} onPress={openNotificationSettings} />
    </View>
  );
}

function StepButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingHorizontal: space(3.5),
        paddingVertical: space(2.5),
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: pressed || disabled ? 0.6 : 1,
      })}
    >
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
