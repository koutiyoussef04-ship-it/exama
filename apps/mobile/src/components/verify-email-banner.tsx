import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Card, Chevron, colors, space } from '@/components/ui';
import { formatDate } from '@/lib/billing';
import { showVerificationBanner } from '@/lib/email-verification';
import { useAuth } from '@/lib/auth';
import { useEmailVerification } from '@/lib/use-email-verification';

/** Course list: "Confirm your email" for new accounts that haven't yet (opens the verification page). */
export function VerifyEmailBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const state = useEmailVerification().data;
  if (!user || !showVerificationBanner(state)) return null;
  const detail = state?.restrictedFrom ? t('verify.bannerDeadline', { date: formatDate(state.restrictedFrom) }) : t('verify.bannerBody', { email: user.email });
  return (
    <Pressable onPress={() => router.push('/verify-email')} accessibilityRole="button" accessibilityLabel={`${t('verify.bannerTitle')}. ${detail}`}>
      {({ pressed }) => (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: colors.warningSoft, borderColor: colors.warningSoft, opacity: pressed ? 0.75 : 1 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{t('verify.bannerTitle')}</Text>
            <Text style={{ color: colors.muted, fontSize: 14 }}>{detail}</Text>
          </View>
          <Chevron />
        </Card>
      )}
    </Pressable>
  );
}
