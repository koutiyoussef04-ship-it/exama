import type { LoginInput, PasswordResetConfirmInput, RegisterInput, User } from '@study/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, setAuthToken, setUnauthorizedHandler } from './api';
import { tokenStore } from './token-store';

type AuthState = {
  user: User | null;
  isLoading: boolean;
  signIn: (input: LoginInput) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  /** Password reset: the new password is set and the student is signed in with a fresh session. */
  resetPassword: (input: PasswordResetConfirmInput) => Promise<void>;
  signOut: () => Promise<void>;
  /** True after the server rejected the saved session (expired token, deleted account). */
  sessionExpired: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const queryClient = useQueryClient();

  const signOut = useCallback(async () => {
    setAuthToken(null);
    await tokenStore.clear();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const expire = useCallback(async () => {
    setSessionExpired(true);
    await signOut();
  }, [signOut]);

  // Restore session on launch.
  useEffect(() => {
    setUnauthorizedHandler(() => void expire());
    (async () => {
      const token = await tokenStore.get();
      if (token) {
        setAuthToken(token);
        try {
          setUser(await api.me());
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) await expire();
          // Network errors: stay signed out of the UI but keep the token for next launch.
          else setAuthToken(null);
        }
      }
      setIsLoading(false);
    })();
  }, [signOut, expire]);

  const finish = async ({ token, user }: { token: string; user: User }) => {
    setAuthToken(token);
    await tokenStore.set(token);
    setSessionExpired(false);
    setUser(user);
  };

  const value: AuthState = {
    user,
    isLoading,
    signIn: async (input) => finish(await api.login(input)),
    signUp: async (input) => finish(await api.register(input)),
    resetPassword: async (input) => finish(await api.confirmPasswordReset(input)),
    signOut,
    sessionExpired,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
