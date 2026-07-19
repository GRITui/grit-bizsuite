-- Location model (BACKLOG.md P1 "No Location model in POS -- the tenant/org
-- id stands in for 'the default store' on events"). Adds a minimal `Store`
-- model (mirroring grit-inventory's own Store: tenantId, name, isDefault)
-- and a nullable `Order.storeId`, then backfills exactly one
-- `isDefault = true` Store per existing tenant so single-location tenants
-- keep today's behavior unchanged (lib/stores.ts's `resolveOrderStoreId`
-- falls back to this default Store).
--
-- Hand-written, NOT generated via `prisma migrate diff` against a live
-- database — there is no reachable DATABASE_URL in this sandbox (see
-- HANDOFF.md's note on this known process gap). Written by hand to match
-- this app's existing migration conventions: `ADD COLUMN IF NOT EXISTS` /
-- `CREATE TABLE IF NOT EXISTS` for idempotency (see
-- 20260718120000_grit_pos_pivot's header comment for why), and
-- `gen_random_uuid()` for backfilled ids, matching
-- packages/database/migrations/0001_core.sql's note that it's built into
-- PostgreSQL 13+ (Neon runs newer) with no extension required.
--
-- Apply with `npx prisma migrate deploy` (requires a reachable
-- DATABASE_URL) or psql. Before running for real, verify it against a
-- Neon branch / shadow database — it has NOT been exercised here.

-- ---------------------------------------------------------------------------
-- Store: one row per physical location a tenant sells from.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "stores" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stores_tenantId_code_key"
  ON "stores"("tenantId", "code");

CREATE INDEX IF NOT EXISTS "stores_tenantId_idx"
  ON "stores"("tenantId");

DO $$ BEGIN
  ALTER TABLE "stores"
    ADD CONSTRAINT "stores_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Data backfill: one default Store per existing tenant. Deterministic
-- `stores_default_<md5(tenantId)>` code so this INSERT is safe to re-run
-- (ON CONFLICT DO NOTHING against the tenantId+code unique index) instead of
-- double-creating a default store for a tenant that already has one from a
-- prior partial application of this migration.
-- ---------------------------------------------------------------------------

INSERT INTO "stores" ("id", "tenantId", "name", "code", "isDefault", "createdAt")
SELECT
    gen_random_uuid()::text,
    t."id",
    'Main',
    'DEFAULT',
    true,
    CURRENT_TIMESTAMP
FROM "tenants" t
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Order: nullable pointer to the Store the sale happened at. NULL means
-- "use the tenant's default Store" (lib/stores.ts) — no checkout flow sets
-- this yet, so every existing and newly-created Order stays NULL here,
-- which is the zero-behavior-change path.
-- ---------------------------------------------------------------------------

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT;

CREATE INDEX IF NOT EXISTS "orders_storeId_idx"
  ON "orders"("storeId");

DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
