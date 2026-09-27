import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Body, Card, colors, Screen, SectionLabel, space } from '@/components/ui';
import { AI_LANGUAGE_PREFS, LANGUAGES, NATIVE_NAMES, type AiLanguagePref, type Language } from '@/i18n/languages';
import { usePreferences } from '@/lib/preferences';

function Option({ label, selected, onPress, lang }: { label: string; selected: boolean; onPress: () => void; lang?: Language }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityLanguage={lang}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(3),
        minHeight: 52,
        paddingVertical: space(2),
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: selected ? colors.primary : colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />}
      </View>
      <Text style={{ flex: 1, fontSize: 16, color: colors.text, fontWeight: selected ? '700' : '400' }}>{label}</Text>
      {selected && <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>{t('language.selected')}</Text>}
    </Pressable>
  );
}

export default function LanguageScreen() {
  const { t } = useTranslation();
  const { appLanguage, aiLanguagePref, setAppLanguage, setAiLanguagePref } = usePreferences();

  const aiLabel = (p: AiLanguagePref) =>
    p === 'app' ? t('language.currentSameAsApp', { language: NATIVE_NAMES[appLanguage] }) : p === 'source' ? t('language.sameAsMaterial') : NATIVE_NAMES[p];

  return (
    <Screen>
      <Card style={{ gap: space(1) }}>
        <SectionLabel>{t('language.appSection')}</SectionLabel>
        <Body muted style={{ fontSize: 14 }}>{t('language.appHint')}</Body>
        <View accessibilityRole="radiogroup">
          {LANGUAGES.map((lang) => (
            <Option key={lang} lang={lang} label={NATIVE_NAMES[lang]} selected={lang === appLanguage} onPress={() => void setAppLanguage(lang)} />
          ))}
        </View>
      </Card>
      <Card style={{ gap: space(1) }}>
        <SectionLabel>{t('language.aiSection')}</SectionLabel>
        <Body muted style={{ fontSize: 14 }}>{t('language.aiHint')}</Body>
        <View accessibilityRole="radiogroup">
          {AI_LANGUAGE_PREFS.map((p) => (
            <Option key={p} label={aiLabel(p)} selected={p === aiLanguagePref} onPress={() => void setAiLanguagePref(p)} />
          ))}
        </View>
      </Card>
    </Screen>
  );
}
