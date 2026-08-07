// TSK-001 catalog-unification, Phase 3: one-time (but idempotent/resumable —
// safe to re-run any number of times) backfill/reconciliation for POS-local
// Product/Variant rows that predate real catalog sync (BACKLOG.md's
// "POS <-> Inventory SKU alignment" entry, loop/design-docs/
// TSK-001-catalog-unification-design.md's "Migration path" section).
//
// Phases 1-2 (already shipped) only handle catalog data going FORWARD from
// the moment Inventory publishes a `catalog.variant_synced` event. Every
// POS Variant created before that — or seeded directly into POS's DB, or a
// legacy hospitality item with no SKU at all — has `inventoryVariantId:
// null` and will NEVER get linked by the live sync path, since that path
// only fires on an Inventory-side create/rename/delete. This script walks
// those orphaned rows once (per tenant) and resolves each one of three ways,
// exactly matching the design doc's three migration-path outcomes:
//
//   (a) `sku` is set and an Inventory Variant with the same (tenantId, sku)
//       already exists -> just link (no new Inventory data — POS's local
//       row was probably created via Inventory's own admin UI, or matches
//       for some other legitimate reason, and simply never received the
//       sync event, e.g. it predates catalog-unification shipping at all).
//   (b) `sku` is set but no Inventory match exists -> push this item INTO
//       Inventory as a new canonical Product+Variant (isStockTracked:
//       true — a real SKU implies a real stock-tracked good), then link
//       back.
//   (c) `sku` is null (the "coffee problem" — a made-to-order hospitality
//       item with no discrete inventory unit, per
//       apps/grit-pos/prisma/schema.prisma's own "legacy hospitality
//       variants have neither tenantId nor sku" comment) -> push into
//       Inventory as a new canonical Product+Variant with
//       isStockTracked: false (the design doc's explicit recommendation
//       over inventing a separate POS-local-only escape hatch), minting a
//       new SKU on the Inventory side (Variant.sku is required+unique
//       there) and writing that SAME minted SKU back onto the POS Variant
//       row too, so both sides share a real join key going forward instead
//       of leaning on the id link alone.
//
// Idempotency / resumability (this script deliberately has NO maintenance-
// window requirement — safe to run against a live system, and safe to
// re-run or resume after a crash):
//   - Only ever selects POS Variants with `inventoryVariantId: null`, so an
//     already-linked row is never revisited.
//   - Case (b)'s "push as new" first re-checks the (tenantId, sku) lookup
//     immediately before creating — if a previous run crashed AFTER
//     creating the Inventory row but BEFORE writing the link back onto
//     POS, this re-check finds that same row on the SKU it already has and
//     links to it instead of violating Inventory's own
//     @@unique([tenantId, sku]) by trying to create a duplicate.
//   - Case (c) mints a SKU deterministically from the POS Variant's own id
//     (`deriveMintedSku`), so a crash-and-resume can find and re-link an
//     already-created-but-unlinked Inventory row by that same derived SKU
//     instead of minting a second one.
//
// Explicitly out of scope (per the design doc's own open questions —
// product decisions, not something this script infers):
//   - Whether a genuinely ephemeral, never-catalog item should stay
//     POS-local forever. This script's stance (matching the doc's stated
//     recommendation) is that even made-to-order items become canonical
//     Inventory records — there is no POS-local-only outcome here.
//   - The category-model mismatch (POS flat Category vs. Inventory's two-
//     level ItemGroup/ItemSubGroup) is resolved with the simplest workable
//     default — a per-tenant "Migrated from POS" ItemGroup, with an
//     ItemSubGroup named after the POS Category being migrated — not a
//     real answer to the deeper UX question, which stays open.
//
// Usage:
//   POS_DATABASE_URL=postgresql://root:postgres@localhost:5432/grit_pos \
//   INVENTORY_DATABASE_URL=postgresql://root:postgres@localhost:5432/grit_inventory \
//   npx tsx dev/local-run/backfill-catalog-unification.ts [--org=<tenantId>] [--dry-run]
//
// Omit --org to process every POS tenant that has a matching Inventory
// tenant (same id — the established cross-app tenancy mapping). A POS
// tenant with no Inventory tenant at all is skipped and reported, not
// silently pushed into creating one (provisioning a tenant is a real
// onboarding decision, not this script's job).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as PosPrismaClient } from "../../apps/grit-pos/app/generated/prisma/client";
import { PrismaClient as InventoryPrismaClient } from "../../apps/grit-inventory/src/generated/prisma/client";

const posDbUrl = process.env.POS_DATABASE_URL;
const inventoryDbUrl = process.env.INVENTORY_DATABASE_URL;
if (!posDbUrl || !inventoryDbUrl) {
  throw new Error("Both POS_DATABASE_URL and INVENTORY_DATABASE_URL are required");
}

const dryRun = process.argv.includes("--dry-run");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const onlyOrgId = orgArg ? orgArg.slice("--org=".length) : undefined;

const pos = new PosPrismaClient({ adapter: new PrismaPg({ connectionString: posDbUrl }) });
const inventory = new InventoryPrismaClient({ adapter: new PrismaPg({ connectionString: inventoryDbUrl }) });

const MIGRATED_GROUP_NAME = "Migrated from POS";

/** Deterministic from the POS Variant's own id, so a crash-and-resume can
 * find (and link to) an already-created-but-unlinked Inventory row instead
 * of minting a second SKU for the same POS variant. */
function deriveMintedSku(posVariantId: string): string {
  return `MIGRATED-${posVariantId.slice(-16).toUpperCase()}`;
}

interface Summary {
  linked: number;
  pushedStockTracked: number;
  pushedMadeToOrder: number;
  skippedNoInventoryTenant: number;
  errors: number;
}

async function resolveSubGroup(tenantId: string, categoryName: string) {
  let group = await inventory.itemGroup.findFirst({ where: { tenantId, name: MIGRATED_GROUP_NAME } });
  if (!group) {
    if (dryRun) return null;
    group = await inventory.itemGroup.create({ data: { tenantId, name: MIGRATED_GROUP_NAME } });
  }
  let subGroup = await inventory.itemSubGroup.findFirst({
    where: { tenantId, groupId: group.id, name: categoryName },
  });
  if (!subGroup) {
    if (dryRun) return null;
    subGroup = await inventory.itemSubGroup.create({
      data: { tenantId, groupId: group.id, name: categoryName },
    });
  }
  return subGroup.id;
}

async function pushNewInventoryVariant(params: {
  tenantId: string;
  categoryName: string;
  productName: string;
  variantName: string;
  sku: string;
  price: number;
  isStockTracked: boolean;
}) {
  const subGroupId = await resolveSubGroup(params.tenantId, params.categoryName);
  if (dryRun) return { productId: "dry-run", variantId: "dry-run" };
  const product = await inventory.product.create({
    data: {
      tenantId: params.tenantId,
      name: params.productName,
      isStockTracked: params.isStockTracked,
      subGroupId,
      variants: {
        create: {
          tenantId: params.tenantId,
          sku: params.sku,
          name: params.variantName,
          price: params.price,
          quantityOnHand: 0,
          reorderThreshold: 0,
        },
      },
    },
    include: { variants: true },
  });
  return { productId: product.id, variantId: product.variants[0].id };
}

async function linkPosRow(posVariantId: string, posProductId: string, inventoryVariantId: string, inventoryProductId: string, newSku?: string) {
  if (dryRun) return;
  await pos.$transaction([
    pos.variant.update({
      where: { id: posVariantId },
      data: { inventoryVariantId, ...(newSku ? { sku: newSku } : {}) },
    }),
    pos.product.updateMany({
      where: { id: posProductId, inventoryProductId: null },
      data: { inventoryProductId },
    }),
  ]);
}

async function processTenant(tenantId: string, summary: Summary) {
  const orphans = await pos.variant.findMany({
    where: { tenantId, inventoryVariantId: null },
    include: { product: { include: { category: true } } },
  });

  console.log(`\n[${tenantId}] ${orphans.length} orphaned POS variant(s) to reconcile`);

  for (const variant of orphans) {
    const product = variant.product;
    const effectivePrice = Number(product.basePrice) + Number(variant.priceDelta);
    const categoryName = product.category?.name ?? "Uncategorized";

    try {
      if (variant.sku) {
        const match = await inventory.variant.findUnique({
          where: { tenantId_sku: { tenantId, sku: variant.sku } },
        });
        if (match) {
          console.log(`  linked  sku=${variant.sku} -> existing Inventory variant ${match.id}`);
          await linkPosRow(variant.id, product.id, match.id, match.productId);
          summary.linked++;
          continue;
        }
        console.log(`  pushing sku=${variant.sku} as new Inventory product (stock-tracked)`);
        const created = await pushNewInventoryVariant({
          tenantId,
          categoryName,
          productName: product.name,
          variantName: variant.name,
          sku: variant.sku,
          price: effectivePrice,
          isStockTracked: true,
        });
        await linkPosRow(variant.id, product.id, created.variantId, created.productId);
        summary.pushedStockTracked++;
        continue;
      }

      // sku is null — the "coffee problem". Check first whether a prior,
      // interrupted run already minted+created this one.
      const mintedSku = deriveMintedSku(variant.id);
      let target = await inventory.variant.findUnique({
        where: { tenantId_sku: { tenantId, sku: mintedSku } },
      });
      if (!target) {
        console.log(`  pushing (no sku) "${product.name} / ${variant.name}" as made-to-order (sku=${mintedSku})`);
        const created = await pushNewInventoryVariant({
          tenantId,
          categoryName,
          productName: product.name,
          variantName: variant.name,
          sku: mintedSku,
          price: effectivePrice,
          isStockTracked: false,
        });
        target = { id: created.variantId, productId: created.productId } as typeof target;
      } else {
        console.log(`  resuming (no sku) "${product.name} / ${variant.name}" -> already-created ${mintedSku}`);
      }
      await linkPosRow(variant.id, product.id, target!.id, target!.productId, mintedSku);
      summary.pushedMadeToOrder++;
    } catch (err) {
      console.error(`  ERROR reconciling POS variant ${variant.id} (sku=${variant.sku ?? "null"}):`, err);
      summary.errors++;
    }
  }
}

async function main() {
  console.log(dryRun ? "DRY RUN — no writes will be made\n" : "LIVE RUN — writes will be made\n");

  const tenants = onlyOrgId
    ? await pos.tenant.findMany({ where: { id: onlyOrgId } })
    : await pos.tenant.findMany();

  const summary: Summary = { linked: 0, pushedStockTracked: 0, pushedMadeToOrder: 0, skippedNoInventoryTenant: 0, errors: 0 };

  for (const tenant of tenants) {
    const inventoryTenant = await inventory.tenant.findUnique({ where: { id: tenant.id } });
    if (!inventoryTenant) {
      console.log(`\n[${tenant.id}] (${tenant.name}) skipped — no matching Inventory tenant`);
      summary.skippedNoInventoryTenant++;
      continue;
    }
    await processTenant(tenant.id, summary);
  }

  console.log("\n=== Summary ===");
  console.log(summary);
  if (summary.errors > 0) {
    console.log("\nSome rows failed — re-run this script to retry only the still-unlinked ones.");
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pos.$disconnect();
    await inventory.$disconnect();
  });
