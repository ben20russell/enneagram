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
