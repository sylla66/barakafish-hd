import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AuthContext } from './auth-context';
import { apiRequest } from '../lib/api';
import { clearToken, getToken, setToken } from '../lib/token-storage';
import type { AuthContextValue, AuthUser, UpdateProfileInput } from '../types/auth';

interface MeResponse {
  user: AuthUser;
}

interface VerifyOtpResponse {
  token: string;
  user: AuthUser;
}

interface RequestOtpResponse {
  message: string;
  expires_in_minutes: number;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Si un jeton existe deja, on affiche un etat de chargement le temps de
  // recharger le profil (GET /me).
  const [isLoading, setIsLoading] = useState<boolean>(() => getToken() !== null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await apiRequest<MeResponse>('/me');
      setUser(data.user);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestOtp = useCallback(async (phone: string) => {
    await apiRequest<RequestOtpResponse>('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string, fullName?: string) => {
    const body: Record<string, string> = { phone, code };
    if (fullName && fullName.trim().length > 0) {
      body.full_name = fullName.trim();
    }

    const data = await apiRequest<VerifyOtpResponse>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    setToken(data.token);
    setUser(data.user);
    setIsLoading(false);
  }, []);

  const updateProfile = useCallback(async (input: UpdateProfileInput) => {
    const data = await apiRequest<MeResponse>('/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      requestOtp,
      verifyOtp,
      updateProfile,
      refresh,
      logout,
    }),
    [user, isLoading, requestOtp, verifyOtp, updateProfile, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
