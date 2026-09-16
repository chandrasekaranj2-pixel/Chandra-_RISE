# RISE Portal (rise-gtm)

GTM Partner Introduction Workflow & Startup Introduction Request Workflow
for RISE — a Retail Innovation Ventures (RIV) program. Standalone
application: own repo, own backend, own database. Not part of the RIOS
monorepo (rios.retailinnovation.ai) — a separate app under the same parent
company.

Eventual home: `rise.retailinnovation.ai`.

## Structure

```
backend/       Express + PostgreSQL API
  db.js          connection pool + schema (partners, startups, retailers,
                 introductions, invoices, payouts, notifications, users)
  middleware/auth.js   JWT auth, role guards
  routes/auth.js       login
  routes/portal.js     partner + startup facing endpoints
  routes/admin.js      RIV admin endpoints (full visibility + overrides)
  server.js       entry point
  seed.js         demo data (run once against a fresh database)

frontend/      Vite + React
  src/App.jsx     the whole app — login, partner dashboard, startup
                  dashboard, admin panel (role-gated from one login screen)
  src/api.js      fetch wrapper + typed API surface
  src/brand.js    RIV brand tokens (shared visual identity with RIOS)
```

## Local development

```bash
# backend
cd backend
npm install
cp .env.example .env      # set DATABASE_URL to a local/Supabase Postgres
npm run seed               # creates schema + demo accounts (run once)
npm run dev                 # http://localhost:4100

# frontend (separate terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5180, proxies /api to :4100
```

Demo logins after seeding:
- Admin: `admin@rise-gtm.demo` / `admin123`
- GTM Partner: `partner@rise-gtm.demo` / `partner123`
- Startup: `startup@rise-gtm.demo` / `startup123`

## Deployment

Two independent Netlify services, pointed at a dedicated Supabase Postgres
project:

- **Backend** — Web Service, root directory `backend`, build `npm install`,
  start `npm start`. Env vars: `DATABASE_URL` (Supabase connection string),
  `JWT_SECRET`, `PORT` (Render sets this automatically).
- **Frontend** — Static Site, root directory `frontend`, build
  `npm install && npm run build`, publish directory `dist`. Env var:
  `VITE_API_URL` set to the backend service's public URL. Needs the same
  SPA rewrite rule as RIOS (Settings → Redirects and Rewrites: Source `/*`,
  Destination `/index.html`, Action `Rewrite`).

Schema creation is idempotent (`CREATE TABLE IF NOT EXISTS`) and runs on
every backend boot — no separate migration step needed after the first
`npm run seed`.

## Status lifecycle

`Requested → Pending Startup Agreement → Approved → Introduced → In
Progress → Closed - Won / Closed - Lost / Stalled → Invoiced → Paid →
Payout Complete` — see `backend/db.js`'s `INTRODUCTION_STATUSES` and the
PRD (RISE Module — GTM Partner Introduction Workflow, §6.5) for the full
business rules.

## Known v1 scope gaps (per PRD §12 / Phase 2)

- Bigin CRM sync — partner/startup/retailer records are managed directly
  in this app's admin panel, not synced from Bigin.
- Zoho Sign / Agreement Tracking (PRD §8.5) — the PRD models this as its
  own entity (agreement type, Zoho Sign envelope ID, sent/signed dates,
  a Draft/Sent/Signed/Expired status lifecycle). This app doesn't model
  that as a separate object — it's collapsed into two fields directly on
  the partner/startup record (`agreement_link`, `agreement_signed_date`).
  That's a deliberate simplification, not an oversight: the fuller model
  is fundamentally Bigin/Zoho-Sign-sourced data, and with no real
  integration there's nothing to populate a richer object with yet. Worth
  revisiting once Bigin sync is real.
- WhatsApp notifications — the in-app notification log covers all 7 types
  from PRD §8.8 (New introduction proposed, Status updated, Introduction
  made, Invoice issued, Payment received, Payout issued — "Agreement
  required" is folded into "Status updated" since our flow doesn't have a
  separate event for it), but there's no outbound email/WhatsApp sending
  yet — everything is in-app only.
- Payment-gateway automation — invoices/payouts are tracked and their
  status set manually; no live payment processing.
- Decline path (PRD §12 open question) — a startup can currently only
  *agree* to a partner-proposed introduction, not decline it. The PRD
  itself leaves this as an open question for the team, so it wasn't built.
