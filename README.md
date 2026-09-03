# Enneagram Dashboard

Next.js app for authenticated report access, admin report assignment/import flows, and a static dashboard experience served from `public/report.html`.

## Quick Start

```bash
npm install
npm run dev
```

App default URL: `http://127.0.0.1:3000`

## Verification

```bash
npm run lint
npm test
npm run build
```

## Project Structure

- `app/` — Next.js routes, layouts, and route handlers.
- `lib/` — shared server utilities plus regression tests.
- `public/` — static dashboard assets (`report.html`, `report.js`, admin upload page).
- `docs/` — canonical copy/source references and project documentation.
- `docs/sources/` — raw source material files.
- `legacy/report-ui/` — archived componentized dashboard files not used by the active Next.js app.
- `scripts/` — local utility scripts for linting, extraction, and dev helpers.

**Google OAuth / NextAuth**

This project uses NextAuth with Google as a provider. For the live host `https://enneagramdashboard.vercel.app`, add the following to your Google Cloud OAuth client and your hosting environment.

1) Google Cloud Console (OAuth 2.0 Client)

- OAuth client type: Web application
- Authorized JavaScript origins:
	- https://enneagramdashboard.vercel.app
- Authorized redirect URIs (NextAuth):
	- https://enneagramdashboard.vercel.app/api/auth/callback/google

2) Vercel (or host) environment variables

Set these in Production:

- `GOOGLE_CLIENT_ID` = <your-google-client-id>
- `GOOGLE_CLIENT_SECRET` = <your-google-client-secret>
- `NEXTAUTH_URL` = https://enneagramdashboard.vercel.app
- `NEXTAUTH_SECRET` = <a long random secret>
- `NEXT_PUBLIC_AUTH_BASE_URL` = https://enneagramdashboard.vercel.app

Generate a `NEXTAUTH_SECRET` example:

```bash
openssl rand -hex 32
```

3) Verification

```bash
curl -i -H "Accept: application/json" https://enneagramdashboard.vercel.app/api/auth/providers
curl -i -H "Accept: application/json" https://enneagramdashboard.vercel.app/api/auth/csrf
```

4) Troubleshooting

- If the client shows "Google sign-in backend is not running", ensure `NEXT_PUBLIC_AUTH_BASE_URL` is set to `https://enneagramdashboard.vercel.app` (or the auth server URL if different) and that `/api/auth/*` routes are reachable. Redeploy after setting env vars.
- If host/header mismatches occur, verify `NEXTAUTH_URL` matches the deployed canonical URL. `trustHost: true` is enabled in `app/api/auth/[...nextauth]/route.js`; only use it if you control your reverse proxy headers.

See `docs/AUTH_DEPLOY.md` for a fuller checklist and notes.
