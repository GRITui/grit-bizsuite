import "server-only";

import type { PromotionRule } from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Checkout-time promotion evaluation.
//
// Pure function over the locally cached `PromotionRule` rows (synced by the
// inbound `promotion.updated` webhook, app/api/events/grit/route.ts) and the
// cart's current lines. Never calls another app — grit-pos is offline-first
// and this is the only pricing logic that runs at checkout time.
//
// Discounts are surfaced as a distinct order-total adjustment (a "Discounts"
// line), never by mutating OrderLine.unitPrice — the original line pricing
// stays intact for audit (see app/api/orders/_lib/queries.ts).
//
// LIMITATION (MVP, matches the task spec): if multiple rules could apply to
// overlapping lines, all of them are applied — there is no stacking
// prevention. A cart could double-discount the same units under two
// different promotions running at once. Acceptable for this MVP; a real
// implementation would need a stacking policy (e.g. best-single-rule-per-line,
// or an explicit `stackable` flag on the rule).
// ---------------------------------------------------------------------------

export interface PromotionCartLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface AppliedPromotion {
  ruleId: string;
  name: string;
  amount: number;
}

export interface PromotionEvaluation {
  /** Total discount across every rule that applied, rounded to cents. */
  totalDiscount: number;
  applied: AppliedPromotion[];
}

/** One entry of a PromotionRule.items JSON array (mirrors PromotionUpdatedData.items — snake_case, a cache of the wire payload). */
interface PromotionRuleItem {
  sku: string;
  required_quantity: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseItems(raw: unknown): PromotionRuleItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((it): it is PromotionRuleItem =>
    isRecord(it) &&
    typeof it.sku === "string" &&
    it.sku.length > 0 &&
    typeof it.required_quantity === "number" &&
    Number.isFinite(it.required_quantity) &&
    it.required_quantity > 0,
  );
}

/** Rounds to the nearest cent — money math here is plain `number` (matching OrderDTO's shape), not Decimal. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRuleCurrentlyActive(rule: PromotionRule, now: Date): boolean {
  if (!rule.isActive) return false;
  if (rule.startsAt && now < rule.startsAt) return false;
  if (rule.endsAt && now > rule.endsAt) return false;
  return true;
}

/**
 * Evaluates every currently-active rule in `activeRules` against `lines`
 * (keyed by SKU — see `eventItemSku` in lib/events.ts for how a line's SKU is
 * resolved) and returns the total discount plus a per-rule breakdown.
 *
 * Rules are filtered here (isActive + startsAt/endsAt window) rather than
 * trusted from the caller's query, so this stays correct even if the caller
 * passes an unfiltered set.
 */
export function evaluatePromotions(
  lines: PromotionCartLine[],
  activeRules: PromotionRule[],
): PromotionEvaluation {
  const now = new Date();
  const quantityBySku = new Map<string, number>();
  const unitPriceBySku = new Map<string, number>();
  for (const line of lines) {
    quantityBySku.set(line.sku, (quantityBySku.get(line.sku) ?? 0) + line.quantity);
    // Multiple lines can share a SKU (e.g. same product added twice); keep
    // the first unit price seen — line-splitting on the same SKU at
    // different prices isn't a case this app produces today.
    if (!unitPriceBySku.has(line.sku)) unitPriceBySku.set(line.sku, line.unitPrice);
  }

  const applied: AppliedPromotion[] = [];
  let totalDiscount = 0;

  for (const rule of activeRules) {
    if (!isRuleCurrentlyActive(rule, now)) continue;

    const items = parseItems(rule.items);
    let ruleDiscount = 0;

    switch (rule.type) {
      case "buy_x_pay_y": {
        ruleDiscount = evaluateBuyXPayY(rule, items, quantityBySku, unitPriceBySku);
        break;
      }
      case "buy_x_get_discount": {
        ruleDiscount = evaluateBuyXGetDiscount(rule, items, quantityBySku, unitPriceBySku);
        break;
      }
      case "bundle_deal": {
        ruleDiscount = evaluateBundleDeal(rule, items, quantityBySku, unitPriceBySku);
        break;
      }
      default:
        // Unknown/future rule type cached locally — ignore rather than throw,
        // so an inventory-side addition never breaks checkout here.
        break;
    }

    if (ruleDiscount > 0) {
      const amount = roundCents(ruleDiscount);
      applied.push({ ruleId: rule.id, name: rule.name, amount });
      totalDiscount += amount;
    }
  }

  return { totalDiscount: roundCents(totalDiscount), applied };
}

/** buy_x_pay_y: floor(Q / buyQuantity) complete groups, each giving away (buyQuantity - payQuantity) of the cheapest units — modeled here as that many units at the line's unit price. */
function evaluateBuyXPayY(
  rule: PromotionRule,
  items: PromotionRuleItem[],
  quantityBySku: Map<string, number>,
  unitPriceBySku: Map<string, number>,
): number {
  const buyQuantity = rule.buyQuantity ?? 0;
  const payQuantity = rule.payQuantity ?? 0;
  if (buyQuantity <= 0 || payQuantity < 0 || payQuantity >= buyQuantity) return 0;

  let discount = 0;
  for (const item of items) {
    const quantity = quantityBySku.get(item.sku) ?? 0;
    const unitPrice = unitPriceBySku.get(item.sku);
    if (quantity <= 0 || unitPrice === undefined) continue;

    const groups = Math.floor(quantity / buyQuantity);
    if (groups <= 0) continue;
    discount += groups * (buyQuantity - payQuantity) * unitPrice;
  }
  return discount;
}

/** buy_x_get_discount: cart quantity >= minQuantity unlocks percent-off or fixed-amount-off, capped at that SKU's own subtotal. */
function evaluateBuyXGetDiscount(
  rule: PromotionRule,
  items: PromotionRuleItem[],
  quantityBySku: Map<string, number>,
  unitPriceBySku: Map<string, number>,
): number {
  const minQuantity = rule.minQuantity ?? 0;
  const discountValue = Number(rule.discountValue ?? 0);
  if (discountValue <= 0) return 0;

  let discount = 0;
  for (const item of items) {
    const quantity = quantityBySku.get(item.sku) ?? 0;
    const unitPrice = unitPriceBySku.get(item.sku);
    if (quantity <= 0 || quantity < minQuantity || unitPrice === undefined) continue;

    const lineSubtotal = unitPrice * quantity;
    let lineDiscount = 0;
    if (rule.discountKind === "percent") {
      lineDiscount = (unitPrice * quantity * discountValue) / 100;
    } else if (rule.discountKind === "fixed_amount") {
      lineDiscount = discountValue * quantity;
    }
    discount += Math.min(lineDiscount, lineSubtotal);
  }
  return discount;
}

/** bundle_deal: every required item present at >= its required_quantity unlocks one bundle set at bundlePrice instead of the items' normal combined price; repeats for as many complete sets as the cart holds. */
function evaluateBundleDeal(
  rule: PromotionRule,
  items: PromotionRuleItem[],
  quantityBySku: Map<string, number>,
  unitPriceBySku: Map<string, number>,
): number {
  if (items.length === 0) return 0;
  const bundlePrice = Number(rule.bundlePrice ?? 0);

  let completeSets = Infinity;
  for (const item of items) {
    const quantity = quantityBySku.get(item.sku) ?? 0;
    completeSets = Math.min(completeSets, Math.floor(quantity / item.required_quantity));
    if (completeSets <= 0) return 0;
  }
  if (!Number.isFinite(completeSets) || completeSets <= 0) return 0;

  let normalSetPrice = 0;
  for (const item of items) {
    const unitPrice = unitPriceBySku.get(item.sku);
    if (unitPrice === undefined) return 0; // Shouldn't happen given completeSets > 0 above, but stay defensive.
    normalSetPrice += unitPrice * item.required_quantity;
  }

  const perSetDiscount = normalSetPrice - bundlePrice;
  if (perSetDiscount <= 0) return 0;
  return perSetDiscount * completeSets;
}
