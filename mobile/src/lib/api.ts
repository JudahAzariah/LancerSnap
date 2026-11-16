import { API_URL } from '@/config';
import { supabase } from '@/lib/supabase';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Call the LancerSnap backend as the signed-in user. The backend verifies the
 * access token on every protected request; the client is never trusted.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (session) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}
