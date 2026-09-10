import type { AdminSessionResponse } from '@tux/admin-contracts';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { AdminApiError, adminFetch } from '../lib/adminApi';

type LoadingState = { status: 'loading' };
type UnauthenticatedState = { status: 'unauthenticated' };
type AuthenticatedState = { status: 'authenticated'; session: AdminSessionResponse };
export type AdminSessionState = LoadingState | UnauthenticatedState | AuthenticatedState;

export type AdminSessionContextValue = {
  state: AdminSessionState;
  login(pin: string): Promise<void>;
  logout(): Promise<void>;
  reauthenticate(pin: string): Promise<void>;
  refresh(): Promise<void>;
};

export const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export async function loadAdminSessionBootstrap(): Promise<
  AuthenticatedState | UnauthenticatedState
> {
  try {
    const session = await adminFetch<AdminSessionResponse>('/api/admin/session');
    return { status: 'authenticated', session };
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401)
      return { status: 'unauthenticated' };
    throw error;
  }
}

export function AdminSessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AdminSessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    setState(await loadAdminSessionBootstrap());
  }, []);

  useEffect(() => {
    let active = true;
    void loadAdminSessionBootstrap()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState({ status: 'unauthenticated' });
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (pin: string) => {
    const session = await adminFetch<AdminSessionResponse>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    setState({ status: 'authenticated', session });
  }, []);

  const logout = useCallback(async () => {
    if (state.status === 'authenticated') {
      await adminFetch<{ ok: true }>(
        '/api/admin/logout',
        { method: 'POST' },
        state.session.csrfToken,
      );
    }
    setState({ status: 'unauthenticated' });
  }, [state]);

  const reauthenticate = useCallback(
    async (pin: string) => {
      if (state.status !== 'authenticated') throw new Error('admin_session_required');
      await adminFetch<{ ok: true; reauthenticatedAt: string }>(
        '/api/admin/reauth',
        { method: 'POST', body: JSON.stringify({ pin }) },
        state.session.csrfToken,
      );
    },
    [state],
  );

  const value = useMemo<AdminSessionContextValue>(
    () => ({ state, login, logout, reauthenticate, refresh }),
    [state, login, logout, reauthenticate, refresh],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}
