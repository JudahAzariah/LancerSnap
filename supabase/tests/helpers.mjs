// Test helpers: an in-memory Postgres (PGlite) with just enough of the
// Supabase environment for the migrations to run. Nothing here touches a real
// Supabase project.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// What a Supabase project already provides before our migrations run.
const SUPABASE_BOOTSTRAP = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  -- Supabase's auth.uid(): the signed-in user's id from the request token.
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  -- Supabase Storage's own tables (only the columns LancerSnap uses).
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    metadata jsonb,
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  -- Supabase grants table privileges to these roles by default; row-level
  -- security is what actually protects the data.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/** Fresh database with every migration applied, in filename order. */
export async function createDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_BOOTSTRAP);
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

export async function createUser(db, id, email = `${id}@example.edu`) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}

/** Run `fn` as a Supabase API role, then switch back to the owner. */
export async function asRole(db, role, fn) {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

/** Run `fn` as a signed-in user reaching Supabase directly with their token. */
export async function asUser(db, userId, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try {
    return await asRole(db, 'authenticated', fn);
  } finally {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
