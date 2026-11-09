# Kryvox Arena

Free Fire & BGMI tournament platform. Static frontend (vanilla JS modules, no build step) + Supabase backend + Vercel hosting.

## Layout
- `welcome.html` – entry page (served at `/`), the supplied links-page design, unchanged except asset paths and the "Website" link now pointing to `/home`.
- `app.html` – SPA shell (served for every other route via `vercel.json` rewrites, so refresh works everywhere).
- `assets/css/theme.css` – the supplied homepage design's CSS, verbatim. `assets/css/app.css` – small layout additions only.
- `assets/js/routes.js` – route table (33 routes, each tagged with the stage that builds it). `router.js` – history-API router.
- `assets/js/pages/*.js` – one module per view. `stub.js` renders an honest "not built yet" page.

## Status
All 22 stages are implemented in code. See `DEPLOY.md` for setup and `TESTING.md` for exactly what was and was not verified.

- `supabase/migrations/0001-0006` – schema, payments model + compliance gate, atomic booking and payment RPCs, RLS, storage, audited admin functions.
- `supabase/functions/*` – Edge Functions (OTP, payments, webhooks, reconcile, manual UPI, email queue). `_shared/` holds pure, unit-tested logic.
- `assets/js/pages/*` – player pages; `assets/js/pages/admin/*` – staff panel.
- `tests/*.test.ts` – unit tests (`node --test tests/otp.test.ts tests/payments.test.ts tests/templates.test.ts`).

## Run locally (see LOCAL.md)
`npm start` → http://localhost:3000 · `npm run dev:all` = website + local Supabase + functions.

## Local preview (old note)
Any static server that rewrites unknown paths to `app.html` (and `/` to `welcome.html`), e.g. `npx vercel dev`.
