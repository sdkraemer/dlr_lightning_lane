# Web app

Next.js App Router dashboard and same-origin API routes, backed by shared SQLite.
Run npm run dev:mock from the repository root for an explicit local-only mock
session, or configure Auth0 and run npm run dev. See ../../README.md.

Auth0 SDK proxy routes handle login/callback/logout; every page/API independently
checks the owner. No browser bearer token or separate Auth0 API is required.
