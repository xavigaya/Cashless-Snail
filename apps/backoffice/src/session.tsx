import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginResult, Me } from '@cashless/shared';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

interface Session {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isPlatformAdmin: boolean;
  canManageOrganization: (organizationId: string) => boolean;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api
      .get<Me>('/auth/me')
      .then(setUser)
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResult>('/auth/login', { email, password });
    setToken(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo<Session>(() => {
    const roles = user?.roles ?? [];
    const isPlatformAdmin = roles.some((r) => r.role === 'platform_admin');
    return {
      user,
      loading,
      login,
      logout,
      isPlatformAdmin,
      canManageOrganization: (orgId) => isPlatformAdmin || roles.some((r) => r.role === 'org_admin' && r.organizationId === orgId),
    };
  }, [user, loading, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession fora de SessionProvider');
  return session;
}
