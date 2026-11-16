/**
 * Client configuration.
 *
 * Only values that are safe to ship inside the app bundle belong here.
 * `EXPO_PUBLIC_*` variables are embedded in the client at build time, so they
 * must NEVER hold secrets (AI provider keys, Supabase secret/service-role keys,
 * database passwords, etc.).
 */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(
  /\/+$/,
  '',
);

/** Supabase project URL. Public by design. */
export const SUPABASE_URL: string = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/**
 * Supabase publishable (anon) key. Public by design: data is protected by
 * backend authorization and row-level security, not by hiding this key.
 */
export const SUPABASE_PUBLISHABLE_KEY: string =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const IS_SUPABASE_CONFIGURED: boolean =
  SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;
