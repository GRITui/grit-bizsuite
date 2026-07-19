import { NextRequest, NextResponse } from "next/server";
import { assertFeature } from "@grit/passport";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { hasRole } from "@/lib/auth";
import { entitlementResponse, requireGritContext } from "@/lib/passport";
import {
  createPromotionSchema,
  fetchPromotionScopeById,
  publishPromotionUpdate,
  syncPromotionExclusions,
  validateExclusionOwnership,
} from "@/lib/promotions";

/**
 * Grit BizSuite pivot: pricing/promotion rules admin. SCALE only, reusing
 * the existing `inventory.multi_location` feature key (no new key added —
 * same convention as Groups/Locations/Transfers).
 */

/** Confirms every referenced variant/sub-group id belongs to the tenant.
 * Returns an error message, or null when everything checks out. */
async function validateScopeOwnership(
  tenantId: string,
  variantIds: string[],
  subGroupIds: string[]
): Promise<string | null> {
  if (variantIds.length > 0) {
    const count = await db.variant.count({ where: { id: { in: variantIds }, tenantId } });
    if (count !== new Set(variantIds).size) return "One or more variants not found";
  }
  if (subGroupIds.length > 0) {
    const count = await db.itemSubGroup.count({ where: { id: { in: subGroupIds }, tenantId } });
    if (count !== new Set(subGroupIds).size) return "One or more sub-groups not found";
  }
  return null;
}

/** GET /api/promotions — the tenant's promotion rules, newest first. */
export async function GET() {
  const ctx = await requireGritContext();
  try {
    assertFeature(ctx.grit, "inventory.multi_location");
  } catch (err) {
    const res = entitlementResponse(err);
    if (res) return res;
    throw err;
  }

  const [promotions, exclusions] = await Promise.all([
    db.promotion.findMany({
      where: { tenantId: ctx.local.tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        scopeVariants: { include: { variant: { select: { id: true, sku: true, name: true } } } },
        scopeGroups: { include: { subGroup: { include: { group: { select: { name: true } } } } } },
      },
    }),
    db.promotionExclusion.findMany({
      where: { tenantId: ctx.local.tenantId },
      select: { promotionId: true, excludedPromotionId: true },
    }),
  ]);

  // Exclusions are stored as one normalized row per undirected pair (see
  // syncPromotionExclusions); expand back out to "every other id this
  // promotion is excluded from" for each side of the pair.
  const exclusionsByPromotionId = new Map<string, string[]>();
  for (const ex of exclusions) {
    exclusionsByPromotionId.set(ex.promotionId, [
      ...(exclusionsByPromotionId.get(ex.promotionId) ?? []),
      ex.excludedPromotionId,
    ]);
    exclusionsByPromotionId.set(ex.excludedPromotionId, [
      ...(exclusionsByPromotionId.get(ex.excludedPromotionId) ?? []),
      ex.promotionId,
    ]);
  }

  return NextResponse.json({
    promotions: promotions.map((p) => ({
      ...p,
      excludedPromotionIds: exclusionsByPromotionId.get(p.id) ?? [],
    })),
  });
}

/** POST /api/promotions — create a promotion rule and publish
 * `promotion.updated` so Grit POS picks it up. */
export async function POST(request: NextRequest) {
  const ctx = await requireGritContext();
  if (!hasRole(ctx.local.role, "ADMIN")) return apiError("Forbidden", 403);
  try {
    assertFeature(ctx.grit, "inventory.multi_location");
  } catch (err) {
    const res = entitlementResponse(err);
    if (res) return res;
    throw err;
  }

  const body = await request.json().catch(() => null);
  const parsed = createPromotionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid promotion");
  }
  const data = parsed.data;
  const variantIds = data.variantIds.map((v) => v.variantId);
  const subGroupIds = "subGroupIds" in data ? data.subGroupIds : [];

  const scopeError = await validateScopeOwnership(ctx.local.tenantId, variantIds, subGroupIds);
  if (scopeError) return apiError(scopeError, 404);

  const exclusionError = await validateExclusionOwnership(ctx.local.tenantId, null, data.excludedPromotionIds);
  if (exclusionError) return apiError(exclusionError, 404);

  // Dedupe scope variants by variantId (last one supplied wins) so a
  // duplicate pick in the UI can't create two PromotionVariant rows for the
  // same variant.
  const dedupedVariants = Array.from(
    new Map(data.variantIds.map((v) => [v.variantId, v.requiredQuantity])).entries()
  );

  const promotion = await db.$transaction(async (tx) => {
    const created = await tx.promotion.create({
      data: {
        tenantId: ctx.local.tenantId,
        name: data.name,
        type: data.type,
        isActive: data.isActive,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        buyQuantity: data.type === "buy_x_pay_y" ? data.buyQuantity : null,
        payQuantity: data.type === "buy_x_pay_y" ? data.payQuantity : null,
        minQuantity: data.type === "buy_x_get_discount" ? data.minQuantity : null,
        discountKind: data.type === "buy_x_get_discount" ? data.discountKind : null,
        discountValue: data.type === "buy_x_get_discount" ? data.discountValue : null,
        bundlePrice: data.type === "bundle_deal" ? data.bundlePrice : null,
        scopeVariants: {
          create: dedupedVariants.map(([variantId, requiredQuantity]) => ({ variantId, requiredQuantity })),
        },
        scopeGroups: { create: subGroupIds.map((subGroupId) => ({ subGroupId })) },
      },
    });
    await syncPromotionExclusions(tx, ctx.local.tenantId, created.id, data.excludedPromotionIds);
    return created;
  });

  const scoped = await fetchPromotionScopeById(promotion.id);
  await publishPromotionUpdate(ctx.local.tenantId, scoped, { deleted: false });

  return NextResponse.json({ promotion: scoped }, { status: 201 });
}
