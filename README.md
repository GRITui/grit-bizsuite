# Grit BizSuite

API-first monorepo merging four standalone SaaS products (plus a fifth,
grit-manpower, built directly in the monorepo rather than merged in) into one
cohesive platform for SMEs, per the *Grit BizSuite Ecosystem Monorepo*
blueprint spec. Each app still runs (and deploys) independently; integration
happens only through shared data contracts and HMAC-signed internal webhook
events — never through direct cross-app database queries.

```
grit-bizsuite/
├── apps/
│   ├── grit-pos/          # (formerly horeca-pos)          front-of-house checkout engine
│   ├── grit-inventory/    # (formerly invento)             multi-location stock tracking
│   ├── grit-taskboard/    # (formerly Sidekickz)           ops kanban & automation
│   ├── grit-reports/      # (formerly Grit-Report-builder) cross-app report constructor
│   └── grit-manpower/     # workforce management: HR records, scheduling, clock-in/out, payroll
├── packages/
│   ├── database/          # @grit/database      canonical schema, migrations, event outbox store
│   ├── shared-events/     # @grit/shared-events event contracts, webhook signing, bus
│   ├── passport/          # @grit/passport      SSO session, RBAC, tier entitlements
│   └── shared-ui/         # @grit/shared-ui     GRITui React components
├── package.json           # npm workspaces
└── turbo.json
```

## Apps

| App | Stack | Pivot delivered |
| --- | --- | --- |
| **grit-pos** | Next.js 16 · Prisma 7 · Neon · Stripe | Hospitality features (QR tables, pickup links) abstracted into optional **plugin traits**; product **variant matrix** (child SKUs + attribute axes); **offline-first** IndexedDB tender/quick-sale queue with idempotent sync; emits `transaction.completed` and `pos.velocity_surge` |
| **grit-inventory** | Next.js 16 · Prisma 7 · Neon | **Multi-location** per-store stock (`StoreStock`) with internal **transfer orders**; **FIFO** cost lots + COGS report; **barcode** keyboard-wedge interception; consumes `transaction.completed` (auto-decrement), emits `inventory.threshold_breached` |
| **grit-taskboard** | No-build JS PWA · Vercel functions · Neon | **Ops kanban** (`todo / in_progress / review / done`) added to the PWA; webhook intake auto-creates *"Restock SKU: X from Supplier Y immediately"*, *"Open auxiliary billing terminal lines"*, and *"Cover \<role\> shift"* cards (`manpower.shift_unassigned`); emits `task.completed`. **"Continue with Grit BizSuite" SSO** (`api/auth-sso.js`) — an additional login path, alongside this app's own username/password, that resolves a verified `grit_passport` token to a shadow account via the existing `team_members`/`grit_org_links` tables (no new schema) |
| **grit-reports** | Static vanilla JS · Vercel functions | Excel Group & Analyze tool + **cross-app aggregator**: financial margins (POS revenue − inventory COGS) and labor efficiency (POS volume ÷ task completion speed), gated by the `custom_reporting` addon |
| **grit-manpower** | Next.js 16 · Prisma 7 · Neon | Employee records (HR profiles + documents), shift **scheduling** per location, **clock-in/out** attendance, and **payroll** generation from time-entry hours + wage rates. Mints the shared `grit_passport` cookie on login (dual-cookie with its own legacy session) and emits `manpower.shift_unassigned` whenever a shift is created/updated with no employee assigned — best-effort delivery only, no durable outbox yet |

## Event flow

```
grit-pos ──transaction.completed──────────▶ grit-inventory ──inventory.threshold_breached──▶ grit-taskboard
   │                                             │                                               │      ▲
   └──pos.velocity_surge─────────────────────────┼───────────────────────────────────────────────┤      │
                                                 └──inventory.transfer_completed──▶ grit-reports ◀┴──task.completed
grit-manpower ──manpower.shift_unassigned────────────────────────────────────────────────────────────────┘
```

Transport: HMAC-signed internal webhooks (`x-grit-signature: v1=hex(hmac-sha256("<ts>.<body>"))`,
shared secret `GRIT_EVENT_WEBHOOK_SECRET`) with a durable Postgres outbox +
cron drain for retries. Contracts live in `packages/shared-events/src/contracts.ts`;
the no-build taskboard mirrors the wire format in `apps/grit-taskboard/lib/gritEvents.js`.
Subscribers are configured per event: `GRIT_SUBSCRIBERS_<EVENT_NAME>` (comma-separated URLs).

## Commercial tiers (Grit Passport)

| Tier | Apps mounted | Notes |
| --- | --- | --- |
| **LITE** | POS | Inventory-facing panels disabled |
| **GROWTH** | POS + Inventory | Single-location tracking only (multi-location tables gated) |
| **SCALE** | POS + Inventory + Taskboard + Reports | Multi-location, transfers, FIFO costing, taskboard automation |
| Addon `custom_reporting` | — | Unlocks the grit-reports aggregation pipelines |

`hasFeatureAccess()` / `appsForSession()` in `@grit/passport` drive both UI
navigation (shared `AppSwitcher`) and API-side gates (`assertFeature`, 403).
grit-manpower is **not** part of this tier system yet — it now mints/verifies
the shared `grit_passport` cookie (`@grit/passport`) for suite-wide SSO, but
has no entitlement gating of its own (no LITE/GROWTH/SCALE distinctions;
sessions it originates are stamped as the full `SCALE` tier precisely so
other apps' `hasFeatureAccess` checks never wrongly deny it — see its
README). It links to/from the other four apps as a plain, ungated URL
instead of an `AppSwitcher` entry (`apps/grit-taskboard/app/index.html`'s
and `apps/grit-reports/excel-group-analyze/app.js`'s suite-nav blocks, and
grit-manpower's own layout) — the same treatment grit-taskboard already gets,
since `buildAppNav`'s tier-gating logic assumes every entry maps onto a real
LITE/GROWTH/SCALE answer, which manpower doesn't have.

## Development

```bash
npm install            # workspace install (root)
npm run build          # turbo build across apps
npm run typecheck      # turbo typecheck
```

Per-app: the three Next apps (`grit-pos`, `grit-inventory`, `grit-manpower`)
build with plain Turbopack (Next 16's default, no `--webpack` flag) and need
`DATABASE_URL` only at runtime, not build time — `packages/**` ship
pre-compiled `dist/**` output (each package's own `tsc` build script, wired
into `turbo run build`'s `dependsOn: ["^build"]`), which is what unblocked
Turbopack resolving `@grit/*` imports; run `npm run build` at least once
before running an app standalone so those `dist/` dirs exist. Inventory's full
test battery: `cd apps/grit-inventory && DATABASE_URL=<postgres> npm run
test:all`. Taskboard and reports have pure-node suites under `tests/`.

### Running the full suite against local Postgres

Each Next app falls back to `@prisma/adapter-pg` for a `localhost`/`127.0.0.1`
`DATABASE_URL` (no real Neon credentials needed for local dev). Taskboard and
reports have no Prisma migrations — taskboard applies its `sql/schema-core.sql`
by hand and reads Postgres through `dev/local-run`'s Neon-mock shim; reports
has no DB of its own (it calls the other apps' HTTP endpoints instead).

1. Create one Postgres 16 database per app (`grit_pos`, `grit_inventory`,
   `grit_manpower`, `grit_taskboard`; reports needs none), and `cp
   .env.example .env` in each app dir, pointing `DATABASE_URL` at each.
2. `npx prisma migrate deploy` inside `grit-pos`, `grit-inventory`, and
   `grit-manpower`; apply `apps/grit-taskboard/sql/schema-core.sql` via `psql`
   for taskboard.
3. Seed demo data with `dev/local-run/seed-demo-pos.ts` +
   `seed-demo-inventory.ts` (or the `seed-trading-co-*`/`seed-demo-clothshop`
   variants) — inventory's seed takes `DEMO_ORG_ID` equal to the tenant id
   POS's seed just printed, since cross-app tenancy is org-id equality, not a
   foreign key.
4. Conventional local ports (matching `packages/passport/src/nav.ts`'s
   `DEFAULT_APP_URLS`, plus `3004` for manpower which isn't part of that
   entitlement-gated nav system): **pos `3000`, inventory `3001`, taskboard
   `3002`, reports `3003`, manpower `3004`.** Start each app on its port,
   then run the no-build apps via `dev/local-run/serve.mjs` (see
   `apps/grit-taskboard/README.md`).
5. For the cross-app event chain (POS sale → Inventory decrement → Taskboard
   restock card) to actually fire locally, set the same
   `GRIT_EVENT_WEBHOOK_SECRET` in all three apps' `.env`, plus
   `GRIT_SUBSCRIBERS_TRANSACTION_COMPLETED=http://localhost:3001/api/events/grit`
   on grit-pos and
   `GRIT_SUBSCRIBERS_INVENTORY_THRESHOLD_BREACHED=http://localhost:3002/api/grit-events`
   on grit-inventory — see `packages/shared-events/src/bus.ts`'s doc comment
   for the full env-var convention.

The canonical platform schema (blueprint Section 3, plus platform extensions)
is in `packages/database/migrations/` with a mirrored Prisma schema. Apps keep
their own historical schemas and adopt canonical naming additively; divergences
are documented in each app's README.

## Provenance

Merged from `GRITui/horeca-pos` (this repo's history), `GRITui/invento`,
`GRITui/Sidekickz`, and `GRITui/Grit-Report-builder` — each source repo carries
a `MONOREPO-MIGRATION.md` pointing here. Each app retains its own
`package.json` / lockfile / `vercel.json` so it can be deployed (or extracted)
standalone.
