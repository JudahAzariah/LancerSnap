import { API_URL } from '@/config';
import { supabase } from '@/lib/supabase';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's own explanation, when it sent one that is safe to show. */
    readonly detail: string | null,
  ) {
    super(detail ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }
}

async function readDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      return body.detail;
    }
  } catch {
    // Not JSON; fall through.
  }
  return null;
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
    throw new ApiError(response.status, await readDetail(response));
  }
  return (await response.json()) as T;
}

function sendJson<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** POST a JSON body to the backend as the signed-in user. */
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return sendJson<T>('POST', path, body);
}

/** PATCH (partially update) with a JSON body as the signed-in user. */
export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return sendJson<T>('PATCH', path, body);
}
