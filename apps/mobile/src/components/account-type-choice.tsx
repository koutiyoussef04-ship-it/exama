/**
 * Sign-up, first step: "How will you use Exama?" — two large cards (student / organization), like the
 * rest of the onboarding. The choice is sent to the server, which stores the account type and decides
 * which experience the account gets; it is never trusted from the client afterwards.
 */
import type { AccountType } from '@study/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Body, Chevron, colors, space, Title } from '@/components/ui';

const CHOICES: { value: AccountType; icon: string }[] = [
  { value: 'student', icon: '🎓' },
  { value: 'organization', icon: '🏢' },
];

export function AccountTypeChoice({ onChoose }: { onChoose: (type: AccountType) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space(4) }}>
      <View style={{ gap: space(1) }}>
        <Title>{t('auth.accountType.question')}</Title>
        <Body muted>{t('auth.accountType.hint')}</Body>
      </View>
      {CHOICES.map(({ value, icon }) => (
        <Pressable
          key={value}
          onPress={() => onChoose(value)}
          accessibilityRole="button"
          accessibilityLabel={t(`auth.accountType.${value}`)}
          accessibilityHint={t(`auth.accountType.${value}Detail`)}
          testID={`account-type-${value}`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(4),
            padding: space(5),
            borderRadius: 16,
            borderWidth: 2,
            borderColor: colors.border,
            backgroundColor: colors.card,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            {/* i18n-ignore */}
            <Text style={{ fontSize: 26 }}>{icon}</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{t(`auth.accountType.${value}`)}</Text>
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{t(`auth.accountType.${value}Detail`)}</Text>
          </View>
          <Chevron />
        </Pressable>
      ))}
    </View>
  );
}
