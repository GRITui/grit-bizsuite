# Invento

Order-fulfillment, inventory, and delivery ops tool. Milestone 1 (MVP): an
admin-only internal console — staff enter and fulfill orders, manage stock,
and track manual deliveries. No public storefront or checkout.

See `docs/ecommerce-stack-handoff.md` for the full architecture spec this
build implements (stack decision, milestone scope, and the Milestone 2
build-to-sell bundle design the schema is already stubbed for).

## Stack

Next.js (App Router) + TypeScript + React + Prisma ORM + Neon serverless
Postgres + Tailwind CSS, deployed as a single app on Vercel, with hand-rolled
JWT auth (`jose` + `bcryptjs`).

## Getting started

1. Create a [Neon](https://neon.tech) Postgres database (or point at any
   Postgres instance for local development — see "Local development without
   Neon" below).
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `AUTH_SECRET`
   (generate with `openssl rand -base64 32`), and `CRON_SECRET`.
3. Install dependencies and apply the schema:

   ```bash
   npm install
   npx prisma migrate deploy   # apply existing migrations
   npm run db:seed             # creates a demo tenant, store, and admin user
   npm run dev
   ```

4. Sign in at `http://localhost:3000/login` with the seeded admin
   (`admin@demo.invento` / `changeme123` by default — override with
   `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars before seeding).

## Local development without Neon

The app's runtime client (`src/lib/db.ts`) uses the Neon serverless driver
adapter, matching the production target. If you want to develop against a
local Postgres instead, the simplest path is running one via Docker or your
package manager and swapping the adapter in `src/lib/db.ts` for
`@prisma/adapter-pg` (already a devDependency, used by the ad-hoc scripts in
`scripts/` for exactly this reason) — just don't commit that swap.

## Background jobs

`vercel.json` configures three Vercel Cron jobs, each hitting an API route
guarded by `CRON_SECRET` (checked as `Authorization: Bearer $CRON_SECRET`):

- `/api/cron/restock-alert` — daily; logs variants at/under their reorder
  threshold.
- `/api/cron/forecast-recompute` — nightly; naive moving-average forecast
  per variant, writes `ForecastSnapshot` rows with a suggested reorder qty.
- `/api/cron/dead-stock-scan` — nightly; flags in-stock variants with no
  sales in the trailing window as `DeadStockFlag` rows.

All three schedules are once/day, so they work on Vercel's Hobby plan as-is.
On a Pro plan or above you can tighten `restock-alert` to run more often
(e.g. hourly) if that cadence is useful.

## Ad-hoc test scripts

Consistent with team convention, this repo uses ad-hoc check-scripts rather
than a test framework. Each connects directly to a real Postgres database
(via `DATABASE_URL`) and exercises the actual business logic in `src/lib/`:

```bash
DATABASE_URL=<a-throwaway-or-local-postgres-url> npm run test:all
```

Or run them individually:

- `npm run test:smoke` — end-to-end order lifecycle: product/variant
  creation → order entry → payment → fulfillment (atomic stock decrement) →
  delivery creation → delivery status updates.
- `npm run test:concurrency` — fires concurrent decrement transactions at a
  single variant and asserts the row-locking in `lib/inventory.ts` never
  oversells or lets stock go negative.
- `npm run test:tenant-isolation` — creates two tenants with colliding SKUs
  and order numbers, asserts every cross-tenant lookup returns nothing.
- `npm run test:background-jobs` — exercises the restock-alert,
  forecast-recompute, and dead-stock-scan logic against seeded data.

These scripts create and clean up their own throwaway tenants, so they're
safe to run repeatedly against a shared dev database.

## Project structure

- `prisma/schema.prisma` — full Milestone 1 schema, plus `Bundle` /
  `BundleComponent` stubbed (unused) for Milestone 2's build-to-sell bundles.
- `src/lib/` — business logic: `inventory.ts` (row-locked stock movements),
  `orders.ts` (order status state machine + fulfillment), `deliveries.ts`
  (delivery status state machine), `auth.ts` / `session.ts` (JWT auth),
  `forecast.ts` / `deadstock.ts` / `restock.ts` (cron job logic).
- `src/app/admin/` — the staff-facing console (products, orders, deliveries,
  reports).
- `src/app/api/` — route handlers; `src/proxy.ts` (Next.js's middleware
  convention) gates everything under `/admin` and `/api` (except
  `/api/auth/login` and `/api/cron/*`) behind a valid session.

## What's deliberately out of scope for M1

Per the handoff: no public storefront/checkout, no third-party courier
integration, no dedicated forecasting/ML service. See the handoff's "Open
Questions" section for what would need answering before scoping those.
