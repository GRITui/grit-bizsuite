-- Backfills exactly one default Store per existing Tenant. The Store table
-- itself (baseline migration) was never followed by the backfill its own
-- schema doc-comment and README describe — this closes that gap so every
-- pre-existing tenant gets a real Store row (matching what new signups now
-- get at registration time, see app/api/auth/register/route.ts) instead of
-- outbound events falling back to the tenant id as a stand-in location_id.
INSERT INTO "stores" ("id", "tenantId", "name", "code", "isDefault", "createdAt")
SELECT gen_random_uuid()::text, "id", 'Main', 'MAIN', true, CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (
  SELECT 1 FROM "stores" s WHERE s."tenantId" = t."id"
);
