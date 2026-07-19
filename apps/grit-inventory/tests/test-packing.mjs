// grit-inventory — tests/test-packing.mjs
//
// Pure-node self test (node:test + node:assert/strict, run via tsx), same
// convention as tests/test-code128.mjs and tests/test-picking.mjs. Covers
// the pure helper functions in src/lib/packing.ts extracted (behavior
// preserving, no DB calls touched) out of `scanPackItem` so its
// transition-state logic is unit-testable without a live Postgres/Prisma
// connection. `scanPackItem` mirrors `scanPickItem` one layer down
// (`quantityPacked` instead of `quantityPicked`), so these mirror
// tests/test-picking.mjs's cases for the shared quantity/timestamp logic,
// plus pack-specific completion-check cases.

import assert from "node:assert/strict";
import test from "node:test";

import { nextScannedQuantity, isPackTaskComplete, resolveTaskTimestamps } from "../src/lib/packing.ts";

// --- nextScannedQuantity ---------------------------------------------------

test("nextScannedQuantity: increments by 1 below the requirement", () => {
  assert.equal(nextScannedQuantity(0, 2), 1);
  assert.equal(nextScannedQuantity(1, 2), 2);
});

test("nextScannedQuantity: caps at required — re-scanning a fulfilled line is a no-op", () => {
  assert.equal(nextScannedQuantity(2, 2), 2);
  assert.equal(nextScannedQuantity(10, 2), 2);
});

test("nextScannedQuantity: quantityRequired of 0 clamps immediately", () => {
  assert.equal(nextScannedQuantity(0, 0), 0);
});

// --- isPackTaskComplete -------------------------------------------------------

test("isPackTaskComplete: false when any item is short of its pack requirement", () => {
  assert.equal(
    isPackTaskComplete([
      { quantityPacked: 1, quantityRequired: 1 },
      { quantityPacked: 0, quantityRequired: 1 },
    ]),
    false
  );
});

test("isPackTaskComplete: true once every item's quantityPacked meets quantityRequired", () => {
  assert.equal(
    isPackTaskComplete([
      { quantityPacked: 1, quantityRequired: 1 },
      { quantityPacked: 3, quantityRequired: 3 },
    ]),
    true
  );
});

test("isPackTaskComplete: vacuously true for an empty item list", () => {
  assert.equal(isPackTaskComplete([]), true);
});

test("isPackTaskComplete: single multi-unit line only completes at the exact threshold, not before", () => {
  const items = [{ quantityPacked: 2, quantityRequired: 3 }];
  assert.equal(isPackTaskComplete(items), false);
  items[0].quantityPacked = 3;
  assert.equal(isPackTaskComplete(items), true);
});

// --- resolveTaskTimestamps (identical contract to lib/picking.ts's) --------

test("resolveTaskTimestamps: first scan stamps startedAt, completedAt stays null while incomplete", () => {
  const now = new Date("2026-07-19T09:00:00Z");
  const result = resolveTaskTimestamps({ allDone: false, now, startedAt: null, completedAt: null });
  assert.equal(result.startedAt, now);
  assert.equal(result.completedAt, null);
});

test("resolveTaskTimestamps: completedAt stamps exactly once, on the scan that completes the task", () => {
  const started = new Date("2026-07-19T09:00:00Z");
  const completingScan = new Date("2026-07-19T09:03:00Z");
  const result = resolveTaskTimestamps({ allDone: true, now: completingScan, startedAt: started, completedAt: null });
  assert.equal(result.startedAt, started);
  assert.equal(result.completedAt, completingScan);
});

test("resolveTaskTimestamps: a redundant scan after completion does not push completedAt forward", () => {
  const started = new Date("2026-07-19T09:00:00Z");
  const completed = new Date("2026-07-19T09:03:00Z");
  const redundantScan = new Date("2026-07-19T09:30:00Z");
  const result = resolveTaskTimestamps({
    allDone: true,
    now: redundantScan,
    startedAt: started,
    completedAt: completed,
  });
  assert.equal(result.completedAt, completed);
  assert.equal(result.startedAt, started);
});
