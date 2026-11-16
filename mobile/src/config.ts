/**
 * Client configuration.
 *
 * Only values that are safe to ship inside the app bundle belong here.
 * `EXPO_PUBLIC_*` variables are embedded in the client at build time, so they
 * must NEVER hold secrets (AI provider keys, Supabase service-role keys, etc.).
 */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(
  /\/+$/,
  '',
);
