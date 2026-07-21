-- Adds Tenant.vatMode ('INCLUSIVE' | 'NONE' | 'EXCLUSIVE'), defaulting every
-- existing tenant to 'INCLUSIVE' so today's VAT-inclusive-only behavior is
-- unchanged. 'EXCLUSIVE' is not yet wired into checkout totals (see
-- computeOrderVat in app/api/orders/_lib/queries.ts) and is rejected at
-- read time until that follow-up ships.
ALTER TABLE "tenants" ADD COLUMN "vatMode" TEXT NOT NULL DEFAULT 'INCLUSIVE';
