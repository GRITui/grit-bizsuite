import type { PromotionUpdatedData } from "@grit/shared-events/contracts";
import { db } from "@/lib/db";
import { publishPromotionUpdated } from "@/lib/events";
import { formatCurrency } from "@/lib/format";

/**
 * Grit BizSuite pivot: pricing/promotion rules admin support. Source of
 * truth lives here (alongside product/group master data); every
 * create/update/deactivate/delete pushes the current rule set to Grit POS
 * via the `promotion.updated` event so checkout can apply it without a live
 * cross-app call (POS is offline-first — see the Promotion model's schema
 * comment and PromotionUpdatedData's docstring in
 * @grit/shared-events/contracts).
 */

/** Shape returned by `fetchPromotionWithScope` — includes everything needed
 * to render a summary and resolve the event's `items` array. */
export type PromotionWithScope = Awaited<ReturnType<typeof fetchPromotionWithScope>>;

const SCOPE_INCLUDE = {
  scopeVariants: {
    include: { variant: { select: { id: true, sku: true, name: true } } },
  },
  scopeGroups: {
    include: {
      subGroup: {
        include: {
          products: {
            include: { variants: { select: { sku: true } } },
          },
        },
      },
    },
  },
} as const;

/** Fetch a tenant-scoped promotion with everything needed to summarize it
 * and resolve its event payload. Returns null when not found. */
export async function fetchPromotionWithScope(id: string, tenantId: string) {
  return db.promotion.findFirst({
    where: { id, tenantId },
    include: SCOPE_INCLUDE,
  });
}

/** Same shape, keyed by promotionId only (used right after a create/update
 * inside the same request, where tenant ownership is already established). */
export async function fetchPromotionScopeById(id: string) {
  return db.promotion.findUniqueOrThrow({
    where: { id },
    include: SCOPE_INCLUDE,
  });
}

type ScopedPromotion = NonNullable<Awaited<ReturnType<typeof fetchPromotionWithScope>>>;

/**
 * Resolves the SKUs a rule applies to: `scopeVariants` directly, plus
 * `scopeGroups` expanded to every product's variants currently in that
 * sub-group (bundle_deal never uses scopeGroups per the schema design, so
 * this is a no-op for that type). Explicit `scopeVariants.requiredQuantity`
 * wins over the group expansion's default of 1 when a SKU appears in both.
 */
export function resolvePromotionItems(
  promo: Pick<ScopedPromotion, "scopeVariants" | "scopeGroups">
): PromotionUpdatedData["items"] {
  const bySku = new Map<string, number>();

  for (const scopeGroup of promo.scopeGroups) {
    for (const product of scopeGroup.subGroup.products) {
      for (const variant of product.variants) {
        if (!bySku.has(variant.sku)) bySku.set(variant.sku, 1);
      }
    }
  }

  for (const scopeVariant of promo.scopeVariants) {
    bySku.set(scopeVariant.variant.sku, scopeVariant.requiredQuantity);
  }

  return Array.from(bySku.entries()).map(([sku, required_quantity]) => ({
    sku,
    required_quantity,
  }));
}

/** Human-readable one-liner per PromotionType, used in the admin list. */
export function promotionSummary(
  promo: Pick<
    ScopedPromotion,
    "type" | "buyQuantity" | "payQuantity" | "minQuantity" | "discountKind" | "discountValue" | "bundlePrice" | "scopeVariants"
  >
): string {
  switch (promo.type) {
    case "buy_x_pay_y":
      return `Buy ${promo.buyQuantity} pay for ${promo.payQuantity}`;
    case "buy_x_get_discount": {
      const value = Number(promo.discountValue ?? 0);
      const discount = promo.discountKind === "percent" ? `${value}% off` : `${formatCurrency(value)} off`;
      return `Buy ${promo.minQuantity}+ get ${discount}`;
    }
    case "bundle_deal": {
      const totalQty = promo.scopeVariants.reduce((sum, v) => sum + v.requiredQuantity, 0);
      return `Bundle: ${formatCurrency(Number(promo.bundlePrice ?? 0))} for ${totalQty} item${totalQty === 1 ? "" : "s"}`;
    }
    default:
      return promo.type;
  }
}

/**
 * Builds and fire-and-forget publishes the `promotion.updated` event for a
 * promotion. `deleted` should be true for an explicit DELETE, or whenever
 * the resulting `isActive` is false — per the event contract's docstring,
 * both mean "stop applying this rule" from POS's perspective, so a
 * deactivate carries the same `deleted: true` signal as a hard delete.
 * Never throws — publish failures must never break the CRUD operation that
 * triggered them (see `publishEventSafe` in lib/events.ts).
 */
export async function publishPromotionUpdate(
  tenantId: string,
  promo: Pick<
    ScopedPromotion,
    | "id"
    | "name"
    | "type"
    | "isActive"
    | "startsAt"
    | "endsAt"
    | "buyQuantity"
    | "payQuantity"
    | "minQuantity"
    | "discountKind"
    | "discountValue"
    | "bundlePrice"
    | "scopeVariants"
    | "scopeGroups"
  >,
  options: { deleted: boolean }
): Promise<void> {
  const deleted = options.deleted || !promo.isActive;
  const data: PromotionUpdatedData = {
    promotion_id: promo.id,
    name: promo.name,
    type: promo.type,
    is_active: promo.isActive,
    deleted,
    starts_at: promo.startsAt ? promo.startsAt.toISOString() : null,
    ends_at: promo.endsAt ? promo.endsAt.toISOString() : null,
    ...(promo.buyQuantity != null ? { buy_quantity: promo.buyQuantity } : {}),
    ...(promo.payQuantity != null ? { pay_quantity: promo.payQuantity } : {}),
    ...(promo.minQuantity != null ? { min_quantity: promo.minQuantity } : {}),
    ...(promo.discountKind != null ? { discount_kind: promo.discountKind } : {}),
    ...(promo.discountValue != null ? { discount_value: Number(promo.discountValue) } : {}),
    ...(promo.bundlePrice != null ? { bundle_price: Number(promo.bundlePrice) } : {}),
    items: resolvePromotionItems(promo),
  };

  try {
    await publishPromotionUpdated(tenantId, data);
  } catch (err) {
    // publishPromotionUpdated already swallows publish errors internally
    // (publishEventSafe); this belt-and-suspenders catch guarantees a bug in
    // event construction itself can never surface as a failed CRUD request.
    console.warn(`[promotions] event publish failed for ${promo.id}:`, err);
  }
}
