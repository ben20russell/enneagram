# Project Structure Guide

This repository is organized to keep active runtime code separate from archived assets and experiments.

## Active Runtime Paths

- `app/`: Next.js routes, layout, and API handlers.
- `lib/`: server utilities and regression tests.
- `public/`: static dashboard assets loaded by the app.
- `scripts/`: tooling scripts for local development and checks.

## Reference and Source Paths

- `docs/`: canonical reference material and project docs.
- `docs/sources/`: raw source PDFs and other large source artifacts.

## Archived Paths

- `legacy/report-ui/`: older componentized dashboard files preserved for reference only.

## Maintenance Rule of Thumb

- Put new production code in `app/`, `lib/`, or `public/` as appropriate.
- Keep historical/unused assets out of the repo root.
- Avoid adding new loose files at the top level unless they are core project configs.
