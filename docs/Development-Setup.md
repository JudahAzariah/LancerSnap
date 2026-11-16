# LancerSnap — Development Setup

How to run the LancerSnap mobile app and backend locally.

## Repository layout

| Path | Contents |
| :--- | :--- |
| `mobile/` | React Native + Expo mobile application (TypeScript) |
| `backend/` | FastAPI backend API (Python) |
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
npm run typecheck
npm run lint
```

## Environment variables and secrets

- Real values live only in local `.env` files, which are git-ignored.
- Only `.env.example` templates (names and safe defaults, no real values) are committed.
- `EXPO_PUBLIC_*` variables are compiled into the mobile app and are visible to
  anyone who has the app. **Never** put secrets in `mobile/.env`.
- API keys, service credentials, and other secrets belong only in `backend/.env`
  (or the deployment's secret manager). See `POLICY.md` §12.
