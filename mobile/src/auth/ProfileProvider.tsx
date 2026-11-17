import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';

export type Role = 'student' | 'staff' | 'administrator';
export type Profile = { id: string; email: string | null; role: Role; team_ids: string[] };

type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: Profile }
  /** The server could not confirm who the user is; nothing is assumed. */
  | { status: 'error' };

type ProfileContextValue = ProfileState & { retry: () => void };

const ProfileContext = createContext<ProfileContextValue | null>(null);

/**
 * Loads the signed-in user's role from the backend. The role only decides
 * which screens are offered; the backend enforces what each role may do.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    apiFetch<Profile>('/me')
      .then((profile) => {
        if (active) setState({ status: 'ready', profile });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return <ProfileContext.Provider value={{ ...state, retry }}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const value = useContext(ProfileContext);
  if (!value) {
    throw new Error('useProfile must be used inside <ProfileProvider>');
  }
  return value;
}
