#!/usr/bin/env node
/* loop/qa/retailer-usecase-sim.mjs
 *
 * QA-Tester-Squad — retailer business-use-case simulation harness.
 *
 * Exercises the REAL production modules (no mocks of the units under test):
 *   - apps/grit-pos/lib/promotions.ts          checkout discount evaluation
 *   - packages/shared-events/src/contracts.ts  cross-app event validation
 *   - packages/shared-events/src/webhook.ts    HMAC webhook signing/verification
 *   - packages/passport/src/entitlements.ts    tier/addon gating
 *
 * Run:
 *   cd <repo root>
 *   node --experimental-strip-types --import ./loop/qa/register-hooks.mjs \
 *     loop/qa/retailer-usecase-sim.mjs
 *
 * (register-hooks.mjs maps grit-pos's Next-only "server-only" import to an
 *  empty module; every other dependency is type-only and stripped.)
 *
 * Each test maps to a retailer use case (UC-xx) a merchant hits in real
 * operations. Pure node:test, no framework deps — same spirit as the
 * taskboard/reports/passport suites.
 */

import assert from "node:assert/strict";
import test from "node:test";

const { normalizeStackingPolicy, evaluatePromotions } = await import(
  "../../apps/grit-pos/lib/promotions.ts"
);
const { EVENT_NAMES, parseGritEvent } = await import(
  "../../packages/shared-events/src/contracts.ts"
);
const { signWebhook, verifyWebhook } = await import(
  "../../packages/shared-events/src/webhook.ts"
);
const {
  TIER_MATRIX,
  appsForOrg,
  appsForSession,
  hasFeatureAccess,
  assertFeature,
  EntitlementError,
} = await import("../../packages/passport/src/entitlements.ts");

void TIER_MATRIX; // imported for parity checks / future suites

// ---------------------------------------------------------------------------
// Fixtures — a small corner-store catalog.
// ---------------------------------------------------------------------------

const NOW = Date.now();
const day = 86_400_000;

/** Minimal PromotionRule-shaped fixture (fields the evaluator actually reads). */
function rule(overrides) {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    type: overrides.type,
    isActive: overrides.isActive ?? true,
    startsAt: overrides.startsAt ?? null,
    endsAt: overrides.endsAt ?? null,
    items: overrides.items ?? [],
    excludedRuleIds: overrides.excludedRuleIds ?? [],
    buyQuantity: overrides.buyQuantity,
    payQuantity: overrides.payQuantity,
    minQuantity: overrides.minQuantity,
    discountValue: overrides.discountValue,
    discountKind: overrides.discountKind,
    bundlePrice: overrides.bundlePrice,
  };
}

const GLOVES = { sku: "GLV-001", quantity: 3, unitPrice: 4 }; // work gloves €4
const BOOTS = { sku: "BT-100", quantity: 2, unitPrice: 100 }; // boots €100

// ---------------------------------------------------------------------------
// Domain A — POS checkout pricing (promotions engine)
// ---------------------------------------------------------------------------

test("UC-P1 · happy-path 3-for-2: corner store sells 3 pairs of gloves, one free", () => {
  const threeForTwo = rule({
    id: "r-promo-3for2",
    type: "buy_x_pay_y",
    buyQuantity: 3,
    payQuantity: 2,
    items: [{ sku: "GLV-001", required_quantity: 3 }],
  });
  const res = evaluatePromotions([GLOVES], [threeForTwo], "NO_STACKING");
  assert.equal(res.totalDiscount, 4); // one glove given away
  assert.equal(res.applied.length, 1);
});

test("UC-P2 · NO_STACKING default: '3-for-2' + 'bulk 10%' on the same SKU never double-discounts", () => {
  const threeForTwo = rule({
    id: "r-a-3for2",
    type: "buy_x_pay_y",
    buyQuantity: 3,
    payQuantity: 2,
    items: [{ sku: "GLV-001", required_quantity: 3 }],
  });
  const bulkTen = rule({
    id: "r-b-bulk10",
    type: "buy_x_get_discount",
    minQuantity: 3,
    discountKind: "percent",
    discountValue: 10,
    items: [{ sku: "GLV-001", required_quantity: 1 }],
  });
  const res = evaluatePromotions([GLOVES], [threeForTwo, bulkTen], "NO_STACKING");
  // 3-for-2 gives 4.00, bulk-10% gives 1.20 — only the best (4.00) applies.
  assert.equal(res.totalDiscount, 4);
  assert.deepEqual(
    res.applied.map((a) => a.ruleId),
    ["r-a-3for2"],
  );
});

test("UC-P3 · STACK_ALL opt-in: merchant who wants generosity gets both rules summed", () => {
  const threeForTwo = rule({
    id: "r-a-3for2",
    type: "buy_x_pay_y",
    buyQuantity: 3,
    payQuantity: 2,
    items: [{ sku: "GLV-001", required_quantity: 3 }],
  });
  const bulkTen = rule({
    id: "r-b-bulk10",
    type: "buy_x_get_discount",
    minQuantity: 3,
    discountKind: "percent",
    discountValue: 10,
    items: [{ sku: "GLV-001", required_quantity: 1 }],
  });
  const res = evaluatePromotions([GLOVES], [threeForTwo, bulkTen], "STACK_ALL");
  assert.equal(res.totalDiscount, 5.2); // 4.00 + 1.20
  assert.equal(res.applied.length, 2);
});

test("UC-P4 · order-wide exclusion: 'New Customer 15%' kills 'Clearance' even on unrelated SKUs", () => {
  const newCust15 = rule({
    id: "r1-newcust15",
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: 15,
    items: [{ sku: "BT-100", required_quantity: 1 }],
  });
  const clearance10 = rule({
    id: "r2-clearance10",
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: 10,
    items: [{ sku: "SK-010", required_quantity: 1 }],
    excludedRuleIds: ["r1-newcust15"], // only ONE side needs to declare it
  });
  const cart = [BOOTS, { sku: "SK-010", quantity: 2, unitPrice: 5 }];
  const res = evaluatePromotions(cart, [clearance10, newCust15], "NO_STACKING");
  // Disjoint SKUs → stacking resolves nothing; exclusion still drops clearance.
  assert.equal(res.totalDiscount, 30); // 15% off the €200 boots subtotal
  assert.deepEqual(
    res.applied.map((a) => a.ruleId),
    ["r1-newcust15"],
  );
});

test("UC-P5 · corrupt tenant policy string falls back to the safe NO_STACKING", () => {
  assert.equal(normalizeStackingPolicy("stack_all"), "NO_STACKING"); // wrong case
  assert.equal(normalizeStackingPolicy(""), "NO_STACKING");
  assert.equal(normalizeStackingPolicy("DROP TABLE tenants"), "NO_STACKING");
});

test("UC-P6 · windowed campaign respects its calendar (not started / already ended)", () => {
  const endedYesterday = rule({
    id: "r-ended",
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: 50,
    items: [{ sku: "GLV-001", required_quantity: 1 }],
    endsAt: new Date(NOW - day),
  });
  const startsTomorrow = rule({
    id: "r-future",
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: 50,
    items: [{ sku: "GLV-001", required_quantity: 1 }],
    startsAt: new Date(NOW + day),
  });
  const res = evaluatePromotions([GLOVES], [endedYesterday, startsTomorrow], "STACK_ALL");
  assert.equal(res.totalDiscount, 0);
  assert.equal(res.applied.length, 0);
});

test("UC-P7 · multi-SKU bundle is atomic under NO_STACKING: shared-SKU conflict yields exactly one winner", () => {
  const richBundle = rule({
    id: "r-bundle-rich",
    type: "bundle_deal",
    bundlePrice: 6, // gloves 4 + socks 5 = €9 normal → €3/set discount
    items: [
      { sku: "GLV-001", required_quantity: 1 },
      { sku: "SK-010", required_quantity: 1 },
    ],
  });
  const socksFree = rule({
    id: "r-socks-free",
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "percent",
    discountValue: 100,
    items: [{ sku: "SK-010", required_quantity: 1 }],
  }); // capped at socks subtotal → €5

  const cart = [
    { sku: "GLV-001", quantity: 1, unitPrice: 4 },
    { sku: "SK-010", quantity: 1, unitPrice: 5 },
  ];
  const res = evaluatePromotions(cart, [richBundle, socksFree], "NO_STACKING");
  // Both touch SK-010 → one conflict group → single best (socks-free, €5) wins;
  // the bundle (€3) is dropped wholesale rather than partially double-counting socks.
  assert.equal(res.applied.length, 1);
  assert.equal(res.totalDiscount, 5);
});

test("UC-P8 · money guards: unprofitable bundles pay nothing, fixed-amount off is capped at line subtotal, unknown types ignored", () => {
  const badBundle = rule({
    id: "r-bad-bundle",
    type: "bundle_deal",
    bundlePrice: 99, // above normal combined price — merchant would LOSE money
    items: [
      { sku: "GLV-001", required_quantity: 1 },
      { sku: "SK-010", required_quantity: 1 },
    ],
  });
  const twoEuroOff = rule({
    id: "r-2eur-off",
    type: "buy_x_get_discount",
    minQuantity: 1,
    discountKind: "fixed_amount",
    discountValue: 2,
    items: [{ sku: "SK-010", required_quantity: 1 }],
  });
  const futureType = rule({ id: "r-mystery", type: "mega_deal_9000" });

  const cart = [{ sku: "SK-010", quantity: 2, unitPrice: 5 }]; // subtotal €10
  const res = evaluatePromotions(cart, [badBundle, twoEuroOff, futureType], "STACK_ALL");
  assert.equal(res.totalDiscount, 4); // fixed_amount is per-unit: 2 × 2 units
  assert.equal(res.applied.length, 1);
});

test("UC-P9 · same SKU split across two cart lines aggregates before promotion math", () => {
  const threeForTwo = rule({
    id: "r-a-3for2",
    type: "buy_x_pay_y",
    buyQuantity: 3,
    payQuantity: 2,
    items: [{ sku: "GLV-001", required_quantity: 3 }],
  });
  const splitCart = [
    { sku: "GLV-001", quantity: 1, unitPrice: 4 },
    { sku: "GLV-001", quantity: 2, unitPrice: 4 },
  ];
  const res = evaluatePromotions(splitCart, [threeForTwo], "NO_STACKING");
  assert.equal(res.totalDiscount, 4); // 1+2 = 3 units → one complete group
});

// ---------------------------------------------------------------------------
// Domain B — sale → stock → restock event chain (contracts + HMAC transport)
// ---------------------------------------------------------------------------

function txCompletedEnvelope() {
  return {
    event: "transaction.completed",
    timestamp: new Date().toISOString(),
    event_id: "evt_pos_0001",
    organization_id: "org_corner_store",
    data: {
      transaction_id: "tx_981",
      location_id: "loc_main_st",
      total_amount: 108.5,
      tax_amount: 8.5,
      offline_synced: false,
      items: [
        { sku: "GLV-001", quantity: 3, price: 4, inventory_variant_id: "var_glov" },
        { sku: "MTO-COFFEE", quantity: 1, price: 3.5 }, // no synced variant
      ],
    },
  };
}

test("UC-E1 · valid POS sale envelope (mixed synced + unsynced lines) passes contract validation", () => {
  assert.ok(parseGritEvent(txCompletedEnvelope()));
});

test("UC-E2 · malformed/tampered envelopes are rejected, not crashed on", () => {
  const base = txCompletedEnvelope();

  const negativeQty = structuredClone(base);
  negativeQty.data.items[0].quantity = -3;
  assert.equal(parseGritEvent(negativeQty), null);

  const noEventId = structuredClone(base);
  delete noEventId.event_id;
  assert.equal(parseGritEvent(noEventId), null);

  const badTs = structuredClone(base);
  badTs.timestamp = "yesterday-ish";
  assert.equal(parseGritEvent(badTs), null);

  const unknownEvent = structuredClone(base);
  unknownEvent.event = "pos.cash_register_exploded";
  assert.equal(parseGritEvent(unknownEvent), null);

  const garbageData = structuredClone(base);
  garbageData.data = "free money";
  assert.equal(parseGritEvent(garbageData), null);

  assert.ok(EVENT_NAMES.includes("inventory.threshold_breached"));
});

test("UC-E3 · HMAC round-trip: publisher-signed webhook verifies on the subscriber", async () => {
  const secret = "GRIT_EVENT_WEBHOOK_SECRET";
  const body = JSON.stringify(txCompletedEnvelope());
  const headers = await signWebhook(secret, "transaction.completed", body);
  assert.equal(headers["x-grit-event"], "transaction.completed");
  assert.ok(
    await verifyWebhook({
      secret,
      rawBody: body,
      signatureHeader: headers["x-grit-signature"],
      timestampHeader: headers["x-grit-timestamp"],
    }),
  );
});

test("UC-E4 · attacker flips total_amount after signing → signature must reject", async () => {
  const secret = "shared-hmac-secret";
  const legitBody = JSON.stringify(txCompletedEnvelope());
  const headers = await signWebhook(secret, "transaction.completed", legitBody);

  const forged = JSON.parse(legitBody);
  forged.data.total_amount = 0.01; // fraud attempt on the wire
  const tamperedBody = JSON.stringify(forged);

  assert.equal(
    await verifyWebhook({
      secret,
      rawBody: tamperedBody,
      signatureHeader: headers["x-grit-signature"],
      timestampHeader: headers["x-grit-timestamp"],
    }),
    false,
  );
});

test("UC-E5 · wrong shared secret (cross-tenant forgery) is rejected", async () => {
  const body = JSON.stringify(txCompletedEnvelope());
  const headers = await signWebhook("secret-of-org-A", "transaction.completed", body);
  assert.equal(
    await verifyWebhook({
      secret: "secret-of-org-B",
      rawBody: body,
      signatureHeader: headers["x-grit-signature"],
      timestampHeader: headers["x-grit-timestamp"],
    }),
    false,
  );
});

test("UC-E6 · replayed webhook outside ±300s tolerance is rejected; inside tolerance still accepted", async () => {
  const secret = "s";
  const body = JSON.stringify(txCompletedEnvelope());
  const tenMinAgo = Math.floor(NOW / 1000) - 600;
  const staleHeaders = await signWebhook(secret, "transaction.completed", body, tenMinAgo);
  assert.equal(
    await verifyWebhook({
      secret,
      rawBody: body,
      signatureHeader: staleHeaders["x-grit-signature"],
      timestampHeader: staleHeaders["x-grit-timestamp"],
    }),
    false,
  );

  const fiveMinAgoSec = Math.floor(NOW / 1000) - 299;
  const freshHeaders = await signWebhook(secret, "transaction.completed", body, fiveMinAgoSec);
  assert.ok(
    await verifyWebhook({
      secret,
      rawBody: body,
      signatureHeader: freshHeaders["x-grit-signature"],
      timestampHeader: freshHeaders["x-grit-timestamp"],
    }),
  );
});

// ---------------------------------------------------------------------------
// Domain C — commercial tiers: what can this retailer actually do?
// ---------------------------------------------------------------------------

test("UC-T1 · LITE corner store: POS only — and the reporting addon buys them NOTHING", () => {
  const liteWithAddon = { tier: "LITE", addons: ["custom_reporting"] };
  assert.ok(hasFeatureAccess(liteWithAddon, "pos.checkout"));
  assert.ok(hasFeatureAccess(liteWithAddon, "pos.offline_mode"));
  assert.equal(hasFeatureAccess(liteWithAddon, "inventory.local_tracking"), false);
  // Addon has minTier GROWTH: a LITE org paying for it gets zero features.
  assert.equal(hasFeatureAccess(liteWithAddon, "reports.custom_builder"), false);
  assert.deepEqual(appsForOrg(liteWithAddon), ["pos"]);
});

test("UC-T2 · GROWTH shop + reporting addon: reports unlock, multi-location stays locked", () => {
  const growth = { tier: "GROWTH", addons: ["custom_reporting"] };
  assert.ok(hasFeatureAccess(growth, "reports.custom_builder"));
  assert.ok(hasFeatureAccess(growth, "inventory.local_tracking"));
  assert.equal(hasFeatureAccess(growth, "inventory.multi_location"), false);
  assert.equal(hasFeatureAccess(growth, "inventory.transfers"), false);
  assert.ok(appsForOrg(growth).includes("reports"));
});

test("UC-T3 · SCALE chain retailer: multi-location, transfers, FIFO costing all granted", () => {
  const scale = { tier: "SCALE", addons: [] };
  for (const f of [
    "inventory.multi_location",
    "inventory.transfers",
    "inventory.fifo_costing",
    "taskboard.automation",
    "reports.standard",
  ]) {
    assert.ok(hasFeatureAccess(scale, f), `SCALE should grant ${f}`);
  }
});

test("UC-T4 · staff clerk at a SCALE org: role trims the app list (no reports/inventory for clerks)", () => {
  const clerk = { role: "staff", tier: "SCALE", addons: [] };
  assert.deepEqual([...appsForSession(clerk)].sort(), ["pos", "taskboard"]);
  const owner = { role: "owner", tier: "SCALE", addons: [] };
  assert.deepEqual([...appsForSession(owner)].sort(), [
    "inventory",
    "pos",
    "reports",
    "taskboard",
  ]);
});

test("UC-T5 · API guard: GROWTH calling transfers endpoint gets typed 403 FEATURE_NOT_ENTITLED", () => {
  const growth = { tier: "GROWTH", addons: ["custom_reporting"] };
  try {
    assertFeature(growth, "inventory.transfers");
    assert.fail("expected EntitlementError");
  } catch (err) {
    assert.ok(err instanceof EntitlementError);
    assert.equal(err.status, 403);
    assert.equal(err.code, "FEATURE_NOT_ENTITLED");
    assert.equal(err.feature, "inventory.transfers");
  }
});

