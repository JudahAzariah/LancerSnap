# LancerSnap — Development Setup

How to run the LancerSnap mobile app and backend locally.

## Repository layout

| Path | Contents |
| :--- | :--- |
| `mobile/` | React Native + Expo mobile application (TypeScript) |
| `backend/` | FastAPI backend API (Python) |
| `supabase/` | Database migrations (SQL) and their tests |
| `docs/` | SDD, Implementation Plan, and this guide |

## Prerequisites

- **Node.js 22.13 or newer** (required by the Expo SDK used in `mobile/`) and npm
- **Python 3.12 or newer**
- Git

## Backend (`backend/`)

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

```bash
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# Windows (Git Bash)
source .venv/Scripts/activate
# macOS / Linux
source .venv/bin/activate
```

Install dependencies and create your local environment file:

```bash
pip install -e ".[dev]"
cp .env.example .env
```

Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

Check it: <http://localhost:8000/health> should return `{"status":"ok"}`.
Interactive API docs are at <http://localhost:8000/docs>.

Quality checks:

```bash
pytest
ruff check .
ruff format --check .
```

## Mobile app (`mobile/`)

```bash
cd mobile
npm install
cp .env.example .env
npm start
```

`npm start` launches the Expo dev server. From there:

- press `w` to open the app in a web browser, or
- scan the QR code with **Expo Go** on a phone, or
- press `a` for an Android emulator / `i` for an iOS simulator (macOS only).

The placeholder home screen shows whether the backend is reachable.

> On a physical phone, `localhost` is the phone itself. Set
> `EXPO_PUBLIC_API_URL` in `mobile/.env` to your computer's LAN address
> (for example `http://192.168.1.20:8000`) and start the backend with
> `--host 0.0.0.0`.

Quality checks:

```bash
npm test
npm run typecheck
npm run lint
```

### Testing on a phone with Expo Go

1. Put the phone and the computer on the same Wi-Fi network.
2. Find the computer's Wi-Fi IP address (`ipconfig` on Windows) and set
   `EXPO_PUBLIC_API_URL=http://<that address>:8000` in `mobile/.env`.
3. Start the backend so other devices can reach it:
   `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
4. Start the app with `npx expo start --lan` in `mobile/`.
5. On the phone, open `http://<that address>:8000/health` in the browser first.
   If it does not load, the computer's firewall or the Wi-Fi network is
   blocking the connection (shared and campus networks often isolate devices;
   a phone hotspot usually works).
6. In the latest Expo Go, choose "Enter URL manually" and open
   `exp://<that address>:8081`.

`--host 0.0.0.0` lets other devices on the network reach the backend. All
endpoints except `/health` still require a signed-in user.

## Supabase authentication

LancerSnap uses Supabase for sign-in. The mobile app signs the user in with
Supabase and sends the access token to the backend, which verifies it on every
protected request.

1. Create a project at <https://supabase.com> (or use the existing LancerSnap project).
2. In the Supabase dashboard, copy two **public** values:
   - **Project URL** (Project Settings → Data API), like `https://<project-ref>.supabase.co`
   - **Publishable key** (Project Settings → API Keys; older projects call it the `anon` key)
3. Put them in the local env files:

   | File | Variable | Value |
   | :--- | :--- | :--- |
   | `mobile/.env` | `EXPO_PUBLIC_SUPABASE_URL` | Project URL |
   | `mobile/.env` | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
   | `backend/.env` | `SUPABASE_URL` | Project URL |

4. Create a test account: Authentication → Users → **Add user**, with an email
   and password, and tick **Auto Confirm User**. There is no self-service
   sign-up in the app; accounts are created by an administrator.
5. Restart both dev servers so they pick up the new values, then sign in.

After signing in, the home screen shows "Server check: your session is
verified" when the backend has accepted the token.

Notes:

- The backend verifies tokens with the project's public signing keys, so it
  needs no Supabase secret. Only if your project still uses the legacy shared
  JWT secret, set `SUPABASE_JWT_SECRET` in `backend/.env` (never in `mobile/`).
- Do **not** put the Supabase secret / `service_role` key or the database
  password in `mobile/.env`.
- Production CBU single sign-on is an open decision (SDD OQ-07) and is not
  implemented.

## Environment variables and secrets

- Real values live only in local `.env` files, which are git-ignored.
- Only `.env.example` templates (names and safe defaults, no real values) are committed.
- `EXPO_PUBLIC_*` variables are compiled into the mobile app and are visible to
  anyone who has the app. **Never** put secrets in `mobile/.env`.
- API keys, service credentials, and other secrets belong only in `backend/.env`
  (or the deployment's secret manager). See `POLICY.md` §12.

## Database

The backend connects to PostgreSQL directly. In the Supabase dashboard click
**Connect**, copy the **Session pooler** connection string, replace
`[YOUR-PASSWORD]` with the database password, and set it as `DATABASE_URL` in
`backend/.env`. This value is a secret: it never goes in `mobile/.env` or in git.

Report photos are stored in a private Supabase Storage bucket. So the backend
can create signed upload and download links, set `SUPABASE_SECRET_KEY` in
`backend/.env` to the project's **secret** API key (Project Settings → API Keys
→ Secret keys, starting `sb_secret_`; older projects: the `service_role` key).
This is a secret with full access to the project: backend only, never in
`mobile/.env`, never in git.

## AI analysis

After a report is saved, the backend can analyze it in the background with an
AI service (LS-11). Submission never waits for it, and an AI outage never stops
a report from being accepted. Choose the provider with `AI_PROVIDER` in
`backend/.env`:

| `AI_PROVIDER` | What happens | Cost |
| :--- | :--- | :--- |
| `disabled` (default) | No analysis. | None |
| `mock` | Built-in fake results labelled "[Mock analysis]". No network calls. Use this for development. | None |
| `anthropic` | Claude via the Anthropic API. Needs `ANTHROPIC_API_KEY`. | **Every analysis is a paid API call** |

- `ANTHROPIC_API_KEY` is a secret: backend only, never in `mobile/.env`, never in git.
- `AI_MODEL` defaults to `claude-haiku-5-5`, the lowest-cost current model
  (chosen by the project owner). Another model can be set here without code
  changes.
- Photos are downscaled and stripped of metadata (including GPS) before they
  are sent. No student identity is sent.
- Each attempt times out after `AI_TIMEOUT_SECONDS` (60). Temporary failures
  are retried up to `AI_MAX_ATTEMPTS` (3) in total; then the analysis is
  recorded as `failed` with a short reason.
- Staff on the report's team and administrators can read the result with
  `GET /reports/{id}/analysis` and send a report again with
  `POST /reports/{id}/analysis`.
- Restart the backend after changing these settings.

Backend tests never call a real AI service.

## Database tests

Backend tests do not use the Supabase database. They start a throwaway in-memory
Postgres from `supabase/`, so run `npm install` in `supabase/` once (Node.js
required); without it, the database tests are skipped.

The schema is defined by SQL migrations in `supabase/migrations/`. See
[Database-Schema.md](Database-Schema.md) for what the tables mean, how to apply
migrations to a Supabase project, and how to run the migration tests.
