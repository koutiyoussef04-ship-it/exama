import type { EmailVerificationState } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

export const emailVerificationKey = (userId: string | undefined) => ['email-verification', userId] as const;

/**
 * The signed-in student's email-verification state. Refetched when the app/tab regains focus, so
 * confirming the email in another tab or the mail app is picked up on return. A failed request
 * leaves `data` undefined: nothing is blocked on the client (the server enforces the rules).
 */
export function useEmailVerification() {
  const { user } = useAuth();
  return useQuery<EmailVerificationState>({
    queryKey: emailVerificationKey(user?.id),
    queryFn: api.getEmailVerification,
    enabled: !!user,
    staleTime: 30_000,
  });
}
