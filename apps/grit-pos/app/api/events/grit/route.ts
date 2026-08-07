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
// Also handles `catalog.variant_synced`. Catalog-unification phases 2-5 (see
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
// hand us. `data.deleted: true` never deletes the Variant row itself (POS
// orders may already reference it via OrderLine) — it flips that Variant's
// own `isActive` to false, and the parent Product's `isActive` follows once
// every sibling Variant has also gone inactive (see
// `markVariantsDeletedIfProductFullyDeleted`'s doc comment for the exact
// logic). Phase 5: `data.vat_applicable` is written to `Variant.vatApplicable`
// on every code path that touches a Variant row — Inventory now owns that
// fact (see CatalogVariantSyncedData's doc comment in
// packages/shared-events/src/contracts.ts); POS has no admin UI that ever
// edited it locally, so this is a pure handoff, not a conflict.
// `data.stock_tracked` is intentionally not persisted (see the handler body)
// — no consumer exists for it in POS yet.
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
 * First tries the original backfill: matches the local Variant by `data.sku`
 * (tenant+sku scoped, same as `Variant.@@unique([tenantId, sku])`). Bug fix
 * alongside the phase 4/5 work below: this used to be a bare `updateMany`
 * that only ever wrote `inventoryVariantId`, silently NOT applying
 * `product_name`/`variant_name` to an already-linked row despite this
 * route's own top-of-file doc comment (and the design doc's Phase 1)
 * describing it as "upsert the new fields onto the existing Variant/Product
 * row it already matches by SKU." That gap meant a catalog rename could
 * never actually reach a previously-synced row, which would have made the
 * phase-4 OrderLine snapshot protection unfalsifiable (nothing to protect
 * against). Now a match does a real `update` (by id, so we have `productId`
 * in hand) that writes `name: data.variant_name`, `inventoryVariantId`, and
 * `vatApplicable: data.vat_applicable` on the Variant, plus `name:
 * data.product_name` on its parent Product — matching how a mirror-CREATE
 * (below) already seeds both names from the same event fields. Price is
 * deliberately left alone on this path — per-variant price reconciliation
 * on an existing row is still out of scope (see the price note further
 * down). Phase 5: `vatApplicable` is written to `Variant.vatApplicable`
 * unconditionally — Inventory owns this fact now, so every code path that
 * touches a Variant row (this one included) syncs it down.
 *
 * On a miss, catalog-unification phase 2 (Inventory is now the source of
 * truth — see this route's top-of-file doc comment) means we mirror-create
 * instead of no-oping:
 *   - an existing local Product with `inventoryProductId === data.product_id`
 *     for this tenant gets a new Variant attached ("mirror_variant_created");
 *   - otherwise a brand-new mirror Product (+ its first Variant) is created,
 *     filed under the tenant's `SYNCED_CATEGORY_NAME` Category, find-or-
 *     created on demand ("mirror_product_created").
 * Both mirror-create paths also set `vatApplicable: data.vat_applicable` on
 * the new Variant, same as the backfill path above — no code path that
 * touches a Variant row skips this.
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
 * `data.stock_tracked` is required on the payload (TypeScript enforces we
 * acknowledge it) but intentionally not persisted anywhere in this app —
 * there's no admin catalog UI in POS to ever surface it, so a stored-but-
 * never-read column would be dead weight. No consumer exists yet.
 *
 * `data.deleted: true` never deletes a mirror-created row outright — POS
 * orders may already reference it via OrderLine. Instead it flips that one
 * Variant's own `isActive` to false (see `markVariantsDeletedIfProductFullyDeleted`),
 * and the parent Product's `isActive` follows only once every sibling
 * Variant under it is also inactive.
 */
async function handleCatalogVariantSynced(event: CatalogVariantSyncedEvent) {
  const { organization_id, data } = event;
  // data.stock_tracked is required by the contract but intentionally not
  // persisted anywhere in this app — see doc comment above. Referenced here
  // (no-op) purely to acknowledge receipt; nothing reads it back.
  void data.stock_tracked;

  const existingVariant = await prisma.variant.findFirst({
    where: { tenantId: organization_id, sku: data.sku },
  });
  if (existingVariant) {
    await prisma.$transaction([
      prisma.variant.update({
        where: { id: existingVariant.id },
        data: {
          inventoryVariantId: data.inventory_variant_id,
          vatApplicable: data.vat_applicable,
          name: data.variant_name,
        },
      }),
      prisma.product.update({
        where: { id: existingVariant.productId },
        data: { name: data.product_name },
      }),
    ]);
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
          vatApplicable: data.vat_applicable,
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
        vatApplicable: data.vat_applicable,
      },
    });
    return { action: "mirror_product_created" as const, productId: product.id, variantId: variant.id };
  });

  return { ok: true, ...result, sku: data.sku };
}

/**
 * `data.deleted: true` on a sku that WAS locally matched (the `"synced"`
 * backfill path) — see `handleCatalogVariantSynced`'s doc comment. Uses the
 * real per-Variant `isActive` flag (catalog-unification phase 3 fix) rather
 * than the old length-based approximation:
 *   1. The matched Variant itself gets `isActive: false` — it, specifically,
 *      is what Inventory just reported gone.
 *   2. Then every sibling Variant under that Variant's parent Product is
 *      queried fresh; the parent Product's `isActive` only flips to `false`
 *      once ALL of them (including the one just updated) are inactive. A
 *      multi-variant mirror Product with live siblings remaining is left
 *      active — deleting one variant no longer wrongly leaves every sibling
 *      (and the product) untouched, nor wrongly deactivates the whole
 *      product while siblings are still sold.
 */
async function markVariantsDeletedIfProductFullyDeleted(tenantId: string, sku: string) {
  const variant = await prisma.variant.findFirst({
    where: { tenantId, sku },
  });
  if (!variant) return;

  await prisma.variant.update({
    where: { id: variant.id },
    data: { isActive: false },
  });

  const remainingActiveSiblings = await prisma.variant.count({
    where: { productId: variant.productId, isActive: true },
  });
  if (remainingActiveSiblings === 0) {
    await prisma.product.update({
      where: { id: variant.productId },
      data: { isActive: false },
    });
  }
}
