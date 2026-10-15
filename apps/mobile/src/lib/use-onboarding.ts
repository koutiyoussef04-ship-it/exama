import type { OnboardingState } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

export const onboardingKey = (userId: string | undefined) => ['onboarding', userId] as const;

/**
 * The signed-in student's onboarding state. Loaded once per session and cached; a failed request
 * leaves `data` undefined, which callers treat as "don't interrupt" (the questions come back the next
 * time the state can be read — the server keeps it `pending`).
 */
export function useOnboarding() {
  const { user } = useAuth();
  return useQuery<OnboardingState>({
    queryKey: onboardingKey(user?.id),
    queryFn: api.getOnboarding,
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}
