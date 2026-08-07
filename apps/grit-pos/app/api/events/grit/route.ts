import "server-only";

import { NextResponse } from "next/server";
import {
  parseGritEvent,
  type CatalogVariantSyncedEvent,
  type DiscountPolicyUpdatedEvent,
  type PromotionUpdatedEvent,
} from "@grit/shared-events/contracts";
import { verifyWebhook } from "@grit/shared-events/webhook";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Inbound Grit BizSuite event webhook (HMAC-signed by @grit/shared-events).
//
// This app has no middleware/proxy.ts route-protection list to exclude this
// route from — every staff-only route instead calls requireTenantId()
// explicitly at the top of its handler (see lib/tenant.ts). This route
// deliberately does not, the same way app/api/stripe/webhook and
// app/api/pickup/** don't: authentication here IS the HMAC signature,
// verified against GRIT_EVENT_WEBHOOK_SECRET, not a staff session.
//
// Handles `promotion.updated` from grit-inventory: upserts (or deletes, when
// `deleted` or `!is_active`) the local `PromotionRule` cache row that
// lib/promotions.ts evaluates at checkout — including the rule's
// `excluded_promotion_ids`, cached verbatim as `excludedRuleIds`. Also
// handles `discount_policy.updated`: updates the tenant's synced
// `discountStackingPolicy`. grit-pos is offline-first and never calls
// another app live at sale time, so this webhook — syncing both ahead of
// time — is the only way a promotion rule or the stacking policy ever
// reaches the register (see PromotionRule/Tenant's schema.prisma doc
// comments and lib/promotions.ts's resolution step).
//
// Also handles `catalog.variant_synced`. Catalog-unification phase 2 (see
// loop/backlog-inbox.md TSK-001, loop/design-docs/TSK-001-catalog-unification-
// design.md): Inventory is now the source of truth for which variants exist;
// POS is a read-only cached mirror. `handleCatalogVariantSynced` first tries
// the original sku-match backfill of `Variant.inventoryVariantId`
// (`"synced"`); on a miss it mirror-creates instead of no-oping — grouping
// under an existing mirrored Product via `Product.inventoryProductId` when
// one exists for `data.product_id` (`"mirror_variant_created"`), or creating
// a brand-new mirror Product+Variant when this is the first variant seen for
// that product (`"mirror_product_created"`), filing new mirror Products
// under a synthetic per-tenant "Synced from Inventory" Category since
// `categoryId` is a required FK and Inventory has no category concept to
// hand us. `data.deleted: true` still doesn't destroy anything (POS orders
// may already reference these rows via OrderLine) — see the handler's own
// doc comment for the exact (partial) "stop offering it" behavior.
//
// Tenancy: the envelope's `organization_id` is used directly as
// `PromotionRule.tenantId` (opaque text, matched by equality) — the same
// convention this app's outbound events use in the other direction (see
// lib/events.ts / lib/velocity.ts doc comments).
//
// Idempotency: no separate dedupe-by-`event_id` table. Both branches below
// (upsert keyed on `id = promotion_id`, delete-if-exists) are naturally
// idempotent — a redelivered/replayed event just re-applies the same end
// state, so there's nothing a dedupe marker would additionally protect here.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const secret = process.env.GRIT_EVENT_WEBHOOK_SECRET;
  if (!secret) {
    // Feature inert without configuration — never crash.
    return NextResponse.json({ error: "Event webhook not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const verified = await verifyWebhook({
    secret,
    rawBody,
    signatureHeader: request.headers.get("x-grit-signature"),
    timestampHeader: request.headers.get("x-grit-timestamp"),
  });
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseGritEvent(json);
  if (!event) {
    return NextResponse.json({ error: "Invalid event envelope" }, { status: 400 });
  }

  try {
    switch (event.event) {
      case "promotion.updated": {
        const result = await handlePromotionUpdated(event as PromotionUpdatedEvent);
        return NextResponse.json(result);
      }
      case "discount_policy.updated": {
        const result = await handleDiscountPolicyUpdated(event as DiscountPolicyUpdatedEvent);
        return NextResponse.json(result);
      }
      case "catalog.variant_synced": {
        const result = await handleCatalogVariantSynced(event as CatalogVariantSyncedEvent);
        return NextResponse.json(result);
      }
      default:
        // Not (yet) a consumer of this event type — acknowledge so the
        // publisher doesn't treat it as a delivery failure and keep retrying.
        return NextResponse.json({ ok: true, ignored: event.event });
    }
  } catch (err) {
    console.error("Failed to process", event.event, event.event_id, err);
    return NextResponse.json({ error: "Internal error handling webhook" }, { status: 500 });
  }
}

async function handlePromotionUpdated(event: PromotionUpdatedEvent) {
  const { organization_id, data } = event;

  if (data.deleted || !data.is_active) {
    // No-op if the row doesn't exist (already removed by an earlier
    // delivery, or was never synced in the first place).
    await prisma.promotionRule.deleteMany({ where: { id: data.promotion_id } });
    return { ok: true, action: "removed" as const, promotion_id: data.promotion_id };
  }

  const shared = {
    tenantId: organization_id,
    name: data.name,
    type: data.type,
    isActive: data.is_active,
    startsAt: data.starts_at ? new Date(data.starts_at) : null,
    endsAt: data.ends_at ? new Date(data.ends_at) : null,
    buyQuantity: data.buy_quantity ?? null,
    payQuantity: data.pay_quantity ?? null,
    minQuantity: data.min_quantity ?? null,
    discountKind: data.discount_kind ?? null,
    discountValue: data.discount_value ?? null,
    bundlePrice: data.bundle_price ?? null,
    items: data.items as unknown as object,
    // Absent/omitted on the wire means "no exclusions" (see
    // PromotionUpdatedData.excluded_promotion_ids's doc comment).
    excludedRuleIds: (data.excluded_promotion_ids ?? []) as unknown as object,
  };

  await prisma.promotionRule.upsert({
    where: { id: data.promotion_id },
    create: { id: data.promotion_id, ...shared },
    update: shared,
  });
  return { ok: true, action: "synced" as const, promotion_id: data.promotion_id };
}

/**
 * Tenant-wide, so unlike `promotion.updated` there's no per-row upsert/delete
 * — just an update of the tenant's own synced setting. `updateMany` (not
 * `update`) so a webhook for a `organization_id` this POS instance has never
 * seen (no matching Tenant row) is a no-op rather than a throw.
 */
async function handleDiscountPolicyUpdated(event: DiscountPolicyUpdatedEvent) {
  const { organization_id, data } = event;

  const result = await prisma.tenant.updateMany({
    where: { id: organization_id },
    data: { discountStackingPolicy: data.policy },
  });
  return {
    ok: true,
    action: result.count > 0 ? ("synced" as const) : ("ignored_unknown_tenant" as const),
    organization_id,
  };
}

/** Per-tenant synthetic Category that mirror-created Products (see
 * `handleCatalogVariantSynced` below) file under, since `Product.categoryId`
 * is a required FK and Inventory's `catalog.variant_synced` payload carries
 * no category concept to map from. Named exactly this on purpose — it's the
 * signal a staff user sees in the POS product list that a row is a mirror,
 * not something they created locally.
 */
const SYNCED_CATEGORY_NAME = "Synced from Inventory";

/**
 * First tries the original backfill: `Variant.inventoryVariantId` for the
 * local Variant matching `data.sku` (tenant+sku scoped, same as
 * `Variant.@@unique([tenantId, sku])`). `updateMany` (not `update`) so a
 * miss is detectable via `result.count === 0` rather than a throw.
 *
 * On a miss, catalog-unification phase 2 (Inventory is now the source of
 * truth — see this route's top-of-file doc comment) means we mirror-create
 * instead of no-oping:
 *   - an existing local Product with `inventoryProductId === data.product_id`
 *     for this tenant gets a new Variant attached ("mirror_variant_created");
 *   - otherwise a brand-new mirror Product (+ its first Variant) is created,
 *     filed under the tenant's `SYNCED_CATEGORY_NAME` Category, find-or-
 *     created on demand ("mirror_product_created").
 * Product.basePrice is only ever set from the FIRST variant synced for a
 * given `product_id` (at Product-creation time) — later variants under the
 * same mirror Product do not overwrite it. A later variant's own effective
 * price is `basePrice + priceDelta` (priceDelta is always 0 for mirror-
 * created variants today), so if `data.price` for a later variant drifts
 * from the product's current effective price, that drift is accepted as-is;
 * perfect per-variant pricing reconciliation is out of scope for this phase
 * (same "deferred to a later phase" spirit as CatalogVariantSyncedData.price's
 * doc comment in packages/shared-events/src/contracts.ts).
 *
 * `data.deleted: true` never deletes a mirror-created row outright — POS
 * orders may already reference it via OrderLine. There's no per-Variant
 * "no longer sold" flag in this schema (only Product.isActive), so a
 * deleted-variant event flips the parent Product's `isActive` to false only
 * when EVERY sibling Variant under it has also been synced-deleted; a lone
 * deleted variant among still-live siblings is left as-is (limitation: that
 * one variant keeps being offered until the whole product is deleted or a
 * later phase adds a Variant-level flag).
 */
async function handleCatalogVariantSynced(event: CatalogVariantSyncedEvent) {
  const { organization_id, data } = event;

  const backfill = await prisma.variant.updateMany({
    where: { tenantId: organization_id, sku: data.sku },
    data: { inventoryVariantId: data.inventory_variant_id },
  });
  if (backfill.count > 0) {
    if (data.deleted === true) {
      await markVariantsDeletedIfProductFullyDeleted(organization_id, data.sku);
    }
    return { ok: true, action: "synced" as const, sku: data.sku };
  }

  if (data.deleted === true) {
    // Never seen locally in the first place — nothing to mirror-delete.
    return { ok: true, action: "ignored_unknown_deleted" as const, sku: data.sku };
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingMirrorProduct = await tx.product.findFirst({
      where: { tenantId: organization_id, inventoryProductId: data.product_id },
    });

    if (existingMirrorProduct) {
      const variant = await tx.variant.create({
        data: {
          productId: existingMirrorProduct.id,
          name: data.variant_name,
          priceDelta: 0,
          tenantId: organization_id,
          sku: data.sku,
          inventoryVariantId: data.inventory_variant_id,
        },
      });
      return { action: "mirror_variant_created" as const, productId: existingMirrorProduct.id, variantId: variant.id };
    }

    let category = await tx.category.findFirst({
      where: { tenantId: organization_id, name: SYNCED_CATEGORY_NAME },
    });
    if (!category) {
      category = await tx.category.create({
        data: { tenantId: organization_id, name: SYNCED_CATEGORY_NAME, sortOrder: 999 },
      });
    }

    const product = await tx.product.create({
      data: {
        tenantId: organization_id,
        name: data.product_name,
        basePrice: data.price,
        inventoryProductId: data.product_id,
        isActive: true,
        categoryId: category.id,
      },
    });
    const variant = await tx.variant.create({
      data: {
        productId: product.id,
        name: data.variant_name,
        priceDelta: 0,
        tenantId: organization_id,
        sku: data.sku,
        inventoryVariantId: data.inventory_variant_id,
      },
    });
    return { action: "mirror_product_created" as const, productId: product.id, variantId: variant.id };
  });

  return { ok: true, ...result, sku: data.sku };
}

/**
 * `data.deleted: true` on a sku that WAS locally matched (the `"synced"`
 * backfill path) — see `handleCatalogVariantSynced`'s doc comment for why
 * this only ever touches the parent Product's `isActive`, never deletes the
 * Variant row itself, and only flips it once every sibling Variant under
 * that Product has also lost its `inventoryVariantId` match... which this
 * schema has no per-Variant way to record. Approximation used here: treat
 * "all siblings gone" as "this Product has exactly one Variant" (the one we
 * just matched) — a multi-variant mirror Product is left as-is (documented
 * limitation), since distinguishing "sibling still live on Inventory" from
 * "sibling never synced-deleted" isn't representable without a Variant-level
 * flag this phase deliberately doesn't add (see route's top-of-file comment).
 */
async function markVariantsDeletedIfProductFullyDeleted(tenantId: string, sku: string) {
  const variant = await prisma.variant.findFirst({
    where: { tenantId, sku },
    include: { product: { include: { variants: true } } },
  });
  if (!variant) return;
  if (variant.product.variants.length <= 1) {
    await prisma.product.update({
      where: { id: variant.product.id },
      data: { isActive: false },
    });
  }
}
