// grit-inventory — tests/test-promotions.mjs
//
// Pure-node self test (node:test + node:assert/strict, run via tsx) for the
// promotions module's DB-free logic (src/lib/promotions.ts):
//   - normalizeExclusionPair: undirected-pair normalization for the
//     PromotionExclusion join table (Tenant.discountStackingPolicy's
//     layer-2 exclusion rules).
//   - resolvePromotionItems: pure map/reduce over scopeVariants/scopeGroups
//     into the promotion.updated event's `items` array.
//   - promotionSummary: per-PromotionType human-readable string formatting.
//   - createPromotionSchema: zod validation/refinements (payQuantity vs
//     buyQuantity, percent discountValue cap, required scope selection),
//     which run before any db.* call so they're pure and safe to unit test.
//
// NOTE ON SCOPE: the union-find stacking *resolution* (resolveStacking,
// evaluatePromotions) that HANDOFF.md describes lives in
// apps/grit-pos/lib/promotions.ts, a different app — out of scope for this
// grit-inventory-only test pass. This file only covers what actually lives
// in apps/grit-inventory/src/lib/promotions.ts.
//
// Do NOT call fetchPromotionWithScope, fetchPromotionScopeById,
// fetchExcludedPromotionIds, validateExclusionOwnership,
// syncPromotionExclusions, publishPromotionUpdate, or
// publishDiscountPolicyUpdate here — those hit db.* / the event bus and
// need a live Postgres/event infra (integration-test territory).

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeExclusionPair,
  resolvePromotionItems,
  promotionSummary,
  createPromotionSchema,
} from "../src/lib/promotions.ts";

// ---------------------------------------------------------------------------
// normalizeExclusionPair
// ---------------------------------------------------------------------------

test("normalizeExclusionPair: orders (a, b) with a < b unchanged", () => {
  assert.deepEqual(normalizeExclusionPair("promo-a", "promo-b"), ["promo-a", "promo-b"]);
});

test("normalizeExclusionPair: orders (b, a) the same way as (a, b) — undirected pair collapses to one row", () => {
  assert.deepEqual(normalizeExclusionPair("promo-b", "promo-a"), ["promo-a", "promo-b"]);
});

test("normalizeExclusionPair: A-excludes-B and B-excludes-A normalize identically", () => {
  const aExcludesB = normalizeExclusionPair("promo-A", "promo-B");
  const bExcludesA = normalizeExclusionPair("promo-B", "promo-A");
  assert.deepEqual(aExcludesB, bExcludesA);
});

test("normalizeExclusionPair: plain string comparison, not length or numeric — 'promo-10' sorts before 'promo-2' lexically", () => {
  assert.deepEqual(normalizeExclusionPair("promo-2", "promo-10"), ["promo-10", "promo-2"]);
});

test("normalizeExclusionPair: identical ids pass through as a degenerate pair (caller is responsible for rejecting self-exclusion)", () => {
  assert.deepEqual(normalizeExclusionPair("same", "same"), ["same", "same"]);
});

// ---------------------------------------------------------------------------
// resolvePromotionItems
// ---------------------------------------------------------------------------

test("resolvePromotionItems: plain scopeVariants resolve with their own requiredQuantity", () => {
  const items = resolvePromotionItems({
    scopeVariants: [
      { variant: { sku: "SKU-1" }, requiredQuantity: 3 },
      { variant: { sku: "SKU-2" }, requiredQuantity: 1 },
    ],
    scopeGroups: [],
  });
  assert.deepEqual(
    items.sort((a, b) => a.sku.localeCompare(b.sku)),
    [
      { sku: "SKU-1", required_quantity: 3 },
      { sku: "SKU-2", required_quantity: 1 },
    ]
  );
});

test("resolvePromotionItems: scopeGroups expand to every product variant's SKU, defaulting required_quantity to 1", () => {
  const items = resolvePromotionItems({
    scopeVariants: [],
    scopeGroups: [
      {
        subGroup: {
          products: [
            { variants: [{ sku: "GROUP-SKU-1" }, { sku: "GROUP-SKU-2" }] },
            { variants: [{ sku: "GROUP-SKU-3" }] },
          ],
        },
      },
    ],
  });
  assert.deepEqual(
    items.sort((a, b) => a.sku.localeCompare(b.sku)),
    [
      { sku: "GROUP-SKU-1", required_quantity: 1 },
      { sku: "GROUP-SKU-2", required_quantity: 1 },
      { sku: "GROUP-SKU-3", required_quantity: 1 },
    ]
  );
});

test("resolvePromotionItems: an explicit scopeVariant requiredQuantity overrides the group-expansion default of 1 for the same SKU", () => {
  const items = resolvePromotionItems({
    scopeVariants: [{ variant: { sku: "SHARED-SKU" }, requiredQuantity: 5 }],
    scopeGroups: [
      {
        subGroup: {
          products: [{ variants: [{ sku: "SHARED-SKU" }] }],
        },
      },
    ],
  });
  assert.deepEqual(items, [{ sku: "SHARED-SKU", required_quantity: 5 }]);
});

test("resolvePromotionItems: order of application matters — scopeVariants always wins regardless of Map insertion order (groups processed first in source)", () => {
  // Same SKU appears in two different sub-groups (group-expansion sets it
  // once, second occurrence is a no-op because bySku.has() guards it), and
  // also has an explicit scopeVariant entry — final value must be the
  // scopeVariant's requiredQuantity, not 1.
  const items = resolvePromotionItems({
    scopeVariants: [{ variant: { sku: "MULTI-SKU" }, requiredQuantity: 7 }],
    scopeGroups: [
      { subGroup: { products: [{ variants: [{ sku: "MULTI-SKU" }] }] } },
      { subGroup: { products: [{ variants: [{ sku: "MULTI-SKU" }] }] } },
    ],
  });
  assert.deepEqual(items, [{ sku: "MULTI-SKU", required_quantity: 7 }]);
});

test("resolvePromotionItems: duplicate SKUs across scopeVariants collapse — last one in iteration order wins (Map.set overwrite)", () => {
  const items = resolvePromotionItems({
    scopeVariants: [
      { variant: { sku: "DUP-SKU" }, requiredQuantity: 2 },
      { variant: { sku: "DUP-SKU" }, requiredQuantity: 9 },
    ],
    scopeGroups: [],
  });
  assert.deepEqual(items, [{ sku: "DUP-SKU", required_quantity: 9 }]);
});

test("resolvePromotionItems: empty scopeVariants and scopeGroups produce an empty items array (bundle_deal-shaped input with no scope yet)", () => {
  assert.deepEqual(resolvePromotionItems({ scopeVariants: [], scopeGroups: [] }), []);
});

test("resolvePromotionItems: a sub-group with no products, or products with no variants, contribute nothing", () => {
  const items = resolvePromotionItems({
    scopeVariants: [],
    scopeGroups: [
      { subGroup: { products: [] } },
      { subGroup: { products: [{ variants: [] }] } },
    ],
  });
  assert.deepEqual(items, []);
});

// ---------------------------------------------------------------------------
// promotionSummary
// ---------------------------------------------------------------------------

test("promotionSummary: buy_x_pay_y formats as 'Buy N pay for M'", () => {
  assert.equal(
    promotionSummary({ type: "buy_x_pay_y", buyQuantity: 3, payQuantity: 2, scopeVariants: [] }),
    "Buy 3 pay for 2"
  );
});

test("promotionSummary: buy_x_get_discount with percent kind appends '% off'", () => {
  assert.equal(
    promotionSummary({
      type: "buy_x_get_discount",
      minQuantity: 2,
      discountKind: "percent",
      discountValue: 15,
      scopeVariants: [],
    }),
    "Buy 2+ get 15% off"
  );
});

test("promotionSummary: buy_x_get_discount with fixed_amount kind formats via formatCurrency", () => {
  const summary = promotionSummary({
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "fixed_amount",
    discountValue: 5,
    scopeVariants: [],
  });
  assert.match(summary, /^Buy 1\+ get .*5.*off$/);
});

test("promotionSummary: buy_x_get_discount with a null/undefined discountValue defaults to 0 rather than throwing", () => {
  const summary = promotionSummary({
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: null,
    scopeVariants: [],
  });
  assert.equal(summary, "Buy 1+ get 0% off");
});

test("promotionSummary: bundle_deal sums requiredQuantity across scopeVariants for the item count", () => {
  const summary = promotionSummary({
    type: "bundle_deal",
    bundlePrice: 25,
    scopeVariants: [
      { requiredQuantity: 2 },
      { requiredQuantity: 3 },
    ],
  });
  assert.match(summary, /for 5 items$/);
});

test("promotionSummary: bundle_deal uses singular 'item' (not 'items') when the total quantity is exactly 1", () => {
  const summary = promotionSummary({
    type: "bundle_deal",
    bundlePrice: 10,
    scopeVariants: [{ requiredQuantity: 1 }],
  });
  assert.match(summary, /for 1 item$/);
  assert.doesNotMatch(summary, /1 items$/);
});

test("promotionSummary: bundle_deal with an empty scopeVariants list totals 0 items (edge case, no throw)", () => {
  const summary = promotionSummary({ type: "bundle_deal", bundlePrice: 10, scopeVariants: [] });
  assert.match(summary, /for 0 items$/);
});

test("promotionSummary: unrecognized/default type falls back to the raw type string", () => {
  assert.equal(
    promotionSummary({ type: "some_future_type", scopeVariants: [] }),
    "some_future_type"
  );
});

// ---------------------------------------------------------------------------
// createPromotionSchema — zod refinements run before any db.* call
// ---------------------------------------------------------------------------

const baseBuyXPayY = {
  type: "buy_x_pay_y",
  name: "Buy 2 pay for 1",
  variantIds: [{ variantId: "v1", requiredQuantity: 1 }],
  subGroupIds: [],
};

test("createPromotionSchema: buy_x_pay_y accepts payQuantity <= buyQuantity", () => {
  const result = createPromotionSchema.safeParse({ ...baseBuyXPayY, buyQuantity: 3, payQuantity: 2 });
  assert.equal(result.success, true);
});

test("createPromotionSchema: buy_x_pay_y accepts payQuantity === buyQuantity (boundary)", () => {
  const result = createPromotionSchema.safeParse({ ...baseBuyXPayY, buyQuantity: 2, payQuantity: 2 });
  assert.equal(result.success, true);
});

test("createPromotionSchema: buy_x_pay_y rejects payQuantity > buyQuantity", () => {
  const result = createPromotionSchema.safeParse({ ...baseBuyXPayY, buyQuantity: 2, payQuantity: 3 });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.path.join(".") === "payQuantity");
  assert.ok(issue, "expected a payQuantity issue");
  assert.match(issue.message, /payQuantity must be less than or equal to buyQuantity/);
});

test("createPromotionSchema: buy_x_pay_y rejects when neither variantIds nor subGroupIds are given", () => {
  const result = createPromotionSchema.safeParse({
    type: "buy_x_pay_y",
    name: "No scope",
    buyQuantity: 2,
    payQuantity: 1,
    variantIds: [],
    subGroupIds: [],
  });
  assert.equal(result.success, false);
});

test("createPromotionSchema: buy_x_pay_y accepts scope via subGroupIds alone (no variantIds needed)", () => {
  const result = createPromotionSchema.safeParse({
    type: "buy_x_pay_y",
    name: "Group scoped",
    buyQuantity: 2,
    payQuantity: 1,
    variantIds: [],
    subGroupIds: ["sub-group-1"],
  });
  assert.equal(result.success, true);
});

test("createPromotionSchema: buy_x_get_discount rejects a percent discountValue over 100", () => {
  const result = createPromotionSchema.safeParse({
    type: "buy_x_get_discount",
    name: "Too much off",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: 150,
    variantIds: [{ variantId: "v1", requiredQuantity: 1 }],
    subGroupIds: [],
  });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.path.join(".") === "discountValue");
  assert.ok(issue);
});

test("createPromotionSchema: buy_x_get_discount accepts a percent discountValue of exactly 100 (boundary)", () => {
  const result = createPromotionSchema.safeParse({
    type: "buy_x_get_discount",
    name: "All off",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: 100,
    variantIds: [{ variantId: "v1", requiredQuantity: 1 }],
    subGroupIds: [],
  });
  assert.equal(result.success, true);
});

test("createPromotionSchema: buy_x_get_discount allows a fixed_amount discountValue over 100 (the >100 cap is percent-only)", () => {
  const result = createPromotionSchema.safeParse({
    type: "buy_x_get_discount",
    name: "Big fixed discount",
    minQuantity: 1,
    discountKind: "fixed_amount",
    discountValue: 500,
    variantIds: [{ variantId: "v1", requiredQuantity: 1 }],
    subGroupIds: [],
  });
  assert.equal(result.success, true);
});

test("createPromotionSchema: buy_x_get_discount rejects a zero or negative discountValue (positive() refinement)", () => {
  const resultZero = createPromotionSchema.safeParse({
    type: "buy_x_get_discount",
    name: "Zero off",
    minQuantity: 1,
    discountKind: "fixed_amount",
    discountValue: 0,
    variantIds: [{ variantId: "v1", requiredQuantity: 1 }],
    subGroupIds: [],
  });
  assert.equal(resultZero.success, false);
});

test("createPromotionSchema: bundle_deal requires at least one variant (min(1) on variantIds, no subGroupIds fallback)", () => {
  const result = createPromotionSchema.safeParse({
    type: "bundle_deal",
    name: "Empty bundle",
    bundlePrice: 20,
    variantIds: [],
  });
  assert.equal(result.success, false);
});

test("createPromotionSchema: bundle_deal accepts a populated variantIds list", () => {
  const result = createPromotionSchema.safeParse({
    type: "bundle_deal",
    name: "Real bundle",
    bundlePrice: 20,
    variantIds: [{ variantId: "v1", requiredQuantity: 2 }],
  });
  assert.equal(result.success, true);
});

test("createPromotionSchema: rejects an unrecognized `type` discriminant", () => {
  const result = createPromotionSchema.safeParse({
    type: "not_a_real_type",
    name: "Bad type",
  });
  assert.equal(result.success, false);
});

test("createPromotionSchema: variantIds entries default requiredQuantity to 1 when omitted", () => {
  const result = createPromotionSchema.safeParse({
    type: "bundle_deal",
    name: "Default qty bundle",
    bundlePrice: 20,
    variantIds: [{ variantId: "v1" }],
  });
  assert.equal(result.success, true);
  assert.equal(result.data.variantIds[0].requiredQuantity, 1);
});

test("createPromotionSchema: excludedPromotionIds defaults to an empty array when omitted (layer-2 stacking exclusions are opt-in)", () => {
  const result = createPromotionSchema.safeParse(baseBuyXPayY.type ? { ...baseBuyXPayY, buyQuantity: 2, payQuantity: 1 } : {});
  assert.equal(result.success, true);
  assert.deepEqual(result.data.excludedPromotionIds, []);
});

test("createPromotionSchema: rejects a non-positive buyQuantity/payQuantity (int().positive() on both)", () => {
  const result = createPromotionSchema.safeParse({ ...baseBuyXPayY, buyQuantity: 0, payQuantity: 0 });
  assert.equal(result.success, false);
});
