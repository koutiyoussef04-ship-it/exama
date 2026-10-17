import type { EmailPreferences } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

export const emailPreferencesKey = (userId: string | undefined) => ['email-preferences', userId] as const;

/** The daily study-plan email preference (server-side), and a mutation to switch it. */
export function useEmailPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery<EmailPreferences>({ queryKey: emailPreferencesKey(user?.id), queryFn: api.getEmailPreferences, enabled: !!user, staleTime: 60_000 });
  const update = useMutation({
    mutationFn: (studyReminders: boolean) => api.updateEmailPreferences(studyReminders),
    onSuccess: (p) => qc.setQueryData(emailPreferencesKey(user?.id), p),
  });
  return { query, update };
}
