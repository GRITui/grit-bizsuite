-- Catalog-unification phases 3-5 follow-up
-- (loop/design-docs/TSK-001-catalog-unification-design.md):
--
-- 1. OrderLine.{productNameSnapshot,variantNameSnapshot,skuSnapshot} —
--    closes the "OrderLine snapshot semantics" gap. unitPrice/lineTotal were
--    already snapshotted at add-line time so historical orders are immune
--    to later catalog price changes; the displayed name/sku was NOT, so a
--    catalog rename synced down from Inventory could silently change a
--    historical order's displayed line item. Nullable + additive: every
--    pre-existing line has no snapshot and falls back to the live
--    Product/Variant join at read time (see app/api/orders/_lib/queries.ts);
--    every line created from this migration forward gets one populated at
--    creation time, same as unitPrice/lineTotal.
--
-- 2. Variant.isActive — replaces the old "this Product has exactly one
--    Variant" approximation in markVariantsDeletedIfProductFullyDeleted
--    (app/api/events/grit/route.ts) with a real per-variant flag, so a
--    multi-variant mirror Product can have individual variants
--    synced-deleted without incorrectly leaving the parent Product active
--    forever OR incorrectly deactivating it while live siblings remain.
--    Defaults true so every existing row (and every newly mirror-created
--    variant) starts "still offered," matching Product.isActive's own
--    default.
ALTER TABLE "order_lines" ADD COLUMN "productNameSnapshot" TEXT;
ALTER TABLE "order_lines" ADD COLUMN "variantNameSnapshot" TEXT;
ALTER TABLE "order_lines" ADD COLUMN "skuSnapshot" TEXT;

ALTER TABLE "variants" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
