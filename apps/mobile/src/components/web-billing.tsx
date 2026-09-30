/**
 * Web billing controls (Stripe). Only ever rendered on the web, for an account whose subscription was
 * bought on the web; the iOS/Android apps show plain text instead and never link to web billing.
 */
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { ErrorText, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { goToStripe } from '@/lib/store/stripe';

/**
 * Coming back with the browser's Back button restores the page as it was when it left (still "busy").
 * Reset the mutation then, so the button works again.
 */
export function useResetOnPageShow(reset: () => void) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);
}

/** "Manage billing": opens Stripe's Customer Portal (payment method, invoices, change plan, cancel). */
export function ManageBillingButton() {
  const { t } = useTranslation();
  const portal = useMutation({
    mutationFn: async () => {
      const { url } = await api.stripePortal();
      goToStripe(url);
      await new Promise(() => {}); // leaving the page
    },
  });
  useResetOnPageShow(portal.reset);
  return (
    <>
      <TextButton title={t('account.manageBilling')} onPress={() => portal.mutate()} disabled={portal.isPending} />
      <ErrorText error={portal.error} />
    </>
  );
}
