-- Adds Product.inventoryProductId: Inventory's canonical Product.id, the
-- stable grouping key catalog-unification phase 2's `catalog.variant_synced`
-- handler (handleCatalogVariantSynced, app/api/events/grit/route.ts) uses to
-- land multiple variants synced over separate events under ONE mirrored
-- Product instead of creating a duplicate Product per variant. Nullable and
-- unindexed-by-default-value: every pre-existing Product was created
-- locally in POS, not mirrored from Inventory, so it stays NULL for them.
-- Indexed because the handler's first move on a sync-miss is a lookup by
-- (tenantId, inventoryProductId).
ALTER TABLE "products" ADD COLUMN "inventoryProductId" TEXT;

-- CreateIndex
CREATE INDEX "products_inventoryProductId_idx" ON "products"("inventoryProductId");
