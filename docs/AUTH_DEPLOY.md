Google OAuth & NextAuth deployment notes
=====================================

This file documents the exact Google redirect URIs and Vercel environment variable setup for the live host
`https://enneagramdashboard.vercel.app`.

1) Google Cloud Console (OAuth 2.0 Client)

- OAuth client type: Web application
- Authorized JavaScript origins:
  - https://enneagramdashboard.vercel.app
- Authorized redirect URIs (required by NextAuth):
  - https://enneagramdashboard.vercel.app/api/auth/callback/google

Notes:
- Google only needs the callback URI above for the OAuth exchange. Add the JavaScript origin to allow browser-based flows.

2) Vercel (or other host) environment variables

Set the following environment variables for your Production environment in the Vercel Dashboard (or equivalent on your host):

- `GOOGLE_CLIENT_ID` = <your-google-client-id>
- `GOOGLE_CLIENT_SECRET` = <your-google-client-secret>
- `NEXTAUTH_URL` = https://enneagramdashboard.vercel.app
- `NEXTAUTH_SECRET` = <a long random secret>
- `NEXT_PUBLIC_AUTH_BASE_URL` = https://enneagramdashboard.vercel.app

Generate a suitable `NEXTAUTH_SECRET` (example):

```bash
# OpenSSL
openssl rand -hex 32

# or node
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

After adding env vars, trigger a deployment (or redeploy) so the runtime picks up the new values.

3) Verify the deployment

- Confirm NextAuth providers endpoint returns JSON:

```bash
curl -i -H "Accept: application/json" https://enneagramdashboard.vercel.app/api/auth/providers
```

- Confirm CSRF endpoint responds:

```bash
curl -i -H "Accept: application/json" https://enneagramdashboard.vercel.app/api/auth/csrf
```

- From the client, clicking Sign In should open the popup and eventually return to `/auth/popup-done` (client-side handler).

4) Troubleshooting

- If the client shows "Google sign-in backend is not running" then `NEXT_PUBLIC_AUTH_BASE_URL` may be wrong or the backend routes are not reachable.
- Ensure `NEXT_PUBLIC_AUTH_BASE_URL` is exactly `https://enneagramdashboard.vercel.app` if the auth server is the same host. If you host auth separately, set it to the auth server URL instead.
- If you used a different domain for the auth server, ensure Google redirect URIs point to that auth server's `/api/auth/callback/google` path.
- `trustHost: true` is set in `app/api/auth/[...nextauth]/route.js`; only use this if you control your proxy and host headers. If you see host-mismatch errors, prefer explicit `NEXTAUTH_URL` and `NEXT_PUBLIC_AUTH_BASE_URL` that match the deployed host.

5) Quick checklist

- [ ] Add `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` in Vercel
- [ ] Set `NEXTAUTH_URL` and `NEXTAUTH_SECRET` in Vercel
- [ ] Set `NEXT_PUBLIC_AUTH_BASE_URL` in Vercel to `https://enneagramdashboard.vercel.app`
- [ ] Add `https://enneagramdashboard.vercel.app/api/auth/callback/google` to Google OAuth redirect URIs
- [ ] Redeploy and test sign-in

If you want, I can add these steps into `README.md` or open a PR with the exact text.*** End Patch