import type { EmailPreferences } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';
import { usePreferences } from './preferences';

export const emailPreferencesKey = (userId: string | undefined) => ['email-preferences', userId] as const;

/**
 * Email preferences (server-side) and a mutation for each of the two separate categories: `update` switches the daily study-plan
 * email, `setMarketing` gives or withdraws consent to marketing emails (the wording shown is in the app language).
 */
export function useEmailPreferences() {
  const { user } = useAuth();
  const { appLanguage } = usePreferences();
  const qc = useQueryClient();
  const query = useQuery<EmailPreferences>({ queryKey: emailPreferencesKey(user?.id), queryFn: api.getEmailPreferences, enabled: !!user, staleTime: 60_000 });
  const update = useMutation({
    mutationFn: (studyReminders: boolean) => api.updateEmailPreferences(studyReminders),
    onSuccess: (p) => qc.setQueryData(emailPreferencesKey(user?.id), p),
  });
  const setMarketing = useMutation({
    mutationFn: (on: boolean) => api.updateMarketingConsent(on, appLanguage),
    onSuccess: (p) => qc.setQueryData(emailPreferencesKey(user?.id), p),
  });
  return { query, update, setMarketing };
}
