// Pure query-shape helper for the VariantLocation `isPrimary` exclusivity
// invariant used by /api/variant-locations (POST) and
// /api/variant-locations/[id] (PATCH).
//
// The schema has no partial unique index expressible via Prisma's
// declarative DSL for "at most one isPrimary row per (storeId, variantId)",
// so application code additionally enforces it: whenever a row is
// created/updated with `isPrimary: true`, every *other* row in the same
// (tenantId, storeId, variantId) scope gets flipped to `isPrimary: false` in
// the same transaction. (DB-level backstop: partial unique index
// `VariantLocation_variantId_storeId_primary_key`, migration
// 20260719003027_variant_location_primary_unique.)
//
// This function builds the `updateMany` WHERE clause for that demotion step.
// Extracted so the shape of the invariant — same-scope match, self-exclusion
// on update but not on create (the new row doesn't exist yet when this runs)
// — is unit-testable without a live Prisma/Postgres connection.

export type PrimaryDemotionWhere = {
  tenantId: string;
  storeId: string;
  variantId: string;
  isPrimary: true;
  id?: { not: string };
};

/**
 * Build the WHERE clause that demotes every other primary row in the same
 * (tenantId, storeId, variantId) scope. Pass `excludeId` (the row being
 * updated) on PATCH so it doesn't try to exclude itself before its own
 * `isPrimary` write lands; omit it on POST, where the new row doesn't exist
 * yet at the time this runs.
 */
export function primaryDemotionWhereClause(
  tenantId: string,
  storeId: string,
  variantId: string,
  excludeId?: string
): PrimaryDemotionWhere {
  return {
    tenantId,
    storeId,
    variantId,
    isPrimary: true,
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
}
