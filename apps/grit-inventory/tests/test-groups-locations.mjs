// grit-inventory — tests/test-groups-locations.mjs
//
// Pure-node self test (node:test + node:assert/strict, run via tsx) for the
// groups-locations module: item-group/sub-group sibling reordering
// (src/lib/groups-locations/reorder.ts) and the VariantLocation `isPrimary`
// exclusivity invariant's query-shape (src/lib/groups-locations/primary.ts).
// Both were extracted, behavior-preserving, from
// src/app/api/item-groups/[id]/route.ts, src/app/api/item-sub-groups/[id]/route.ts,
// and src/app/api/variant-locations/(route.ts|[id]/route.ts) so this logic
// is testable without a live Postgres/Prisma connection — same spirit as
// tests/test-code128.mjs. No live DB.

import assert from "node:assert/strict";
import test from "node:test";

import { resolveReorderSwap } from "../src/lib/groups-locations/reorder.ts";
import { primaryDemotionWhereClause } from "../src/lib/groups-locations/primary.ts";

// ---------------------------------------------------------------------------
// resolveReorderSwap
// ---------------------------------------------------------------------------

const siblings = [
  { id: "a", sortOrder: 0 },
  { id: "b", sortOrder: 1 },
  { id: "c", sortOrder: 2 },
];

test("resolveReorderSwap: moving a middle row up swaps with its immediate predecessor", () => {
  const swap = resolveReorderSwap(siblings, "b", "up");
  assert.ok(swap);
  assert.equal(swap.current.id, "b");
  assert.equal(swap.swapWith.id, "a");
});

test("resolveReorderSwap: moving a middle row down swaps with its immediate successor", () => {
  const swap = resolveReorderSwap(siblings, "b", "down");
  assert.ok(swap);
  assert.equal(swap.current.id, "b");
  assert.equal(swap.swapWith.id, "c");
});

test("resolveReorderSwap: moving the first row up is a no-op (already at the top)", () => {
  assert.equal(resolveReorderSwap(siblings, "a", "up"), null);
});

test("resolveReorderSwap: moving the last row down is a no-op (already at the bottom)", () => {
  assert.equal(resolveReorderSwap(siblings, "c", "down"), null);
});

test("resolveReorderSwap: target id absent from the sibling list is a no-op", () => {
  assert.equal(resolveReorderSwap(siblings, "does-not-exist", "up"), null);
});

test("resolveReorderSwap: single-row list — both directions are no-ops", () => {
  const solo = [{ id: "only", sortOrder: 0 }];
  assert.equal(resolveReorderSwap(solo, "only", "up"), null);
  assert.equal(resolveReorderSwap(solo, "only", "down"), null);
});

test("resolveReorderSwap: empty list is always a no-op", () => {
  assert.equal(resolveReorderSwap([], "anything", "up"), null);
  assert.equal(resolveReorderSwap([], "anything", "down"), null);
});

test("resolveReorderSwap: swap carries the actual sortOrder values, not just ids (caller assigns current<->swapWith sortOrder to perform the swap)", () => {
  const swap = resolveReorderSwap(siblings, "b", "up");
  assert.equal(swap.current.sortOrder, 1);
  assert.equal(swap.swapWith.sortOrder, 0);
  // After the caller applies `current.sortOrder = swapWith.sortOrder` and
  // vice versa, "b" (was 1) becomes 0 and "a" (was 0) becomes 1 — i.e. they
  // trade places without touching "c".
});

test("resolveReorderSwap: two-row list — moving either row is a valid swap, not a no-op", () => {
  const pair = [
    { id: "x", sortOrder: 5 },
    { id: "y", sortOrder: 9 },
  ];
  const up = resolveReorderSwap(pair, "y", "up");
  assert.ok(up);
  assert.equal(up.current.id, "y");
  assert.equal(up.swapWith.id, "x");

  const down = resolveReorderSwap(pair, "x", "down");
  assert.ok(down);
  assert.equal(down.current.id, "x");
  assert.equal(down.swapWith.id, "y");
});

test("resolveReorderSwap: does not mutate the input siblings array", () => {
  const before = JSON.stringify(siblings);
  resolveReorderSwap(siblings, "b", "up");
  assert.equal(JSON.stringify(siblings), before);
});

test("resolveReorderSwap: works identically for item-sub-groups (same generic shape, scoped to a parent group's siblings list by the caller)", () => {
  // The sub-groups route passes siblings already filtered to `groupId:
  // subGroup.groupId` — resolveReorderSwap itself is group-agnostic, it just
  // operates on whatever list it's given.
  const subGroupSiblings = [
    { id: "sg1", sortOrder: 0 },
    { id: "sg2", sortOrder: 1 },
  ];
  const swap = resolveReorderSwap(subGroupSiblings, "sg1", "down");
  assert.ok(swap);
  assert.equal(swap.current.id, "sg1");
  assert.equal(swap.swapWith.id, "sg2");
});

// ---------------------------------------------------------------------------
// primaryDemotionWhereClause — the isPrimary exclusivity invariant
// ---------------------------------------------------------------------------

test("primaryDemotionWhereClause: create path (no excludeId) — scopes to tenant/store/variant/isPrimary, no id filter", () => {
  const where = primaryDemotionWhereClause("tenant-1", "store-1", "variant-1");
  assert.deepEqual(where, {
    tenantId: "tenant-1",
    storeId: "store-1",
    variantId: "variant-1",
    isPrimary: true,
  });
  assert.ok(!("id" in where));
});

test("primaryDemotionWhereClause: update path (excludeId set) — adds an id-not-equal filter so the row being updated can't demote itself", () => {
  const where = primaryDemotionWhereClause("tenant-1", "store-1", "variant-1", "loc-self");
  assert.deepEqual(where, {
    tenantId: "tenant-1",
    storeId: "store-1",
    variantId: "variant-1",
    isPrimary: true,
    id: { not: "loc-self" },
  });
});

test("primaryDemotionWhereClause: always pins isPrimary:true so non-primary rows in the same scope are left untouched", () => {
  const where = primaryDemotionWhereClause("t", "s", "v");
  assert.equal(where.isPrimary, true);
});

test("primaryDemotionWhereClause: scope is exact-match on tenantId/storeId/variantId — different tenants/stores/variants are different scopes", () => {
  const whereA = primaryDemotionWhereClause("tenant-A", "store-1", "variant-1");
  const whereB = primaryDemotionWhereClause("tenant-B", "store-1", "variant-1");
  assert.notDeepEqual(whereA, whereB);

  const whereSameStoreDiffVariant = primaryDemotionWhereClause("tenant-A", "store-1", "variant-2");
  assert.notDeepEqual(whereA, whereSameStoreDiffVariant);
});

test("primaryDemotionWhereClause: excludeId of empty string is falsy — treated like create (no id filter), matching `excludeId ? ... : {}` semantics", () => {
  // Documents actual behavior of the `excludeId ? {...} : {}` guard: an
  // empty-string id (which should never occur for a real cuid/uuid) would
  // fall through to the create-shaped clause rather than adding
  // `id: { not: "" }`. Not a real-world case, but pins the current
  // conditional's behavior against an accidental change to `!== undefined`.
  const where = primaryDemotionWhereClause("t", "s", "v", "");
  assert.ok(!("id" in where));
});

test("primaryDemotionWhereClause: distinct excludeIds produce distinct id-filters (each row demotes every *other* primary row, not itself)", () => {
  const whereFor1 = primaryDemotionWhereClause("t", "s", "v", "loc-1");
  const whereFor2 = primaryDemotionWhereClause("t", "s", "v", "loc-2");
  assert.notDeepEqual(whereFor1, whereFor2);
  assert.deepEqual(whereFor1.id, { not: "loc-1" });
  assert.deepEqual(whereFor2.id, { not: "loc-2" });
});
