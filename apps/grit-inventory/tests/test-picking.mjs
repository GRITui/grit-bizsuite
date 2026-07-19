// grit-inventory — tests/test-picking.mjs
//
// Pure-node self test (node:test + node:assert/strict, run via tsx), same
// convention as tests/test-code128.mjs. Covers the pure helper functions in
// src/lib/picking.ts that were extracted (behavior-preserving, no DB calls
// touched) out of `createPickTask`/`scanPickItem` specifically so their
// transition-state logic is unit-testable without a live Postgres/Prisma
// connection:
//   - nextScannedQuantity: scan-quantity clamping
//   - isPickTaskComplete: all-items-done check
//   - resolveTaskTimestamps: startedAt/completedAt stamping idempotency
//   - resolvePrimaryLocationCodes: isPrimary-per-variant dedup invariant

import assert from "node:assert/strict";
import test from "node:test";

import {
  nextScannedQuantity,
  isPickTaskComplete,
  resolveTaskTimestamps,
  resolvePrimaryLocationCodes,
} from "../src/lib/picking.ts";

// --- nextScannedQuantity ---------------------------------------------------

test("nextScannedQuantity: increments by 1 below the requirement", () => {
  assert.equal(nextScannedQuantity(0, 3), 1);
  assert.equal(nextScannedQuantity(1, 3), 2);
  assert.equal(nextScannedQuantity(2, 3), 3);
});

test("nextScannedQuantity: caps at required — an extra scan of a fulfilled line is a no-op", () => {
  assert.equal(nextScannedQuantity(3, 3), 3);
  assert.equal(nextScannedQuantity(5, 3), 3, "already over-required (shouldn't happen, but must clamp, not grow)");
});

test("nextScannedQuantity: quantityRequired of 0 clamps immediately (edge case: zero-qty line)", () => {
  assert.equal(nextScannedQuantity(0, 0), 0);
});

test("nextScannedQuantity: large single-unit requirement still just increments by one per scan", () => {
  assert.equal(nextScannedQuantity(998, 1000), 999);
});

// --- isPickTaskComplete ------------------------------------------------------

test("isPickTaskComplete: false when any item is short", () => {
  assert.equal(
    isPickTaskComplete([
      { quantityPicked: 3, quantityRequired: 3 },
      { quantityPicked: 1, quantityRequired: 2 },
    ]),
    false
  );
});

test("isPickTaskComplete: true when every item meets its requirement exactly", () => {
  assert.equal(
    isPickTaskComplete([
      { quantityPicked: 3, quantityRequired: 3 },
      { quantityPicked: 2, quantityRequired: 2 },
    ]),
    true
  );
});

test("isPickTaskComplete: true when an item exceeds its requirement (defensive >=, not ==)", () => {
  assert.equal(isPickTaskComplete([{ quantityPicked: 4, quantityRequired: 3 }]), true);
});

test("isPickTaskComplete: vacuously true for an empty item list", () => {
  assert.equal(isPickTaskComplete([]), true);
});

test("isPickTaskComplete: a single zero-required item does not block completion", () => {
  assert.equal(
    isPickTaskComplete([
      { quantityPicked: 0, quantityRequired: 0 },
      { quantityPicked: 2, quantityRequired: 2 },
    ]),
    true
  );
});

// --- resolveTaskTimestamps ---------------------------------------------------

test("resolveTaskTimestamps: first scan on a fresh task stamps startedAt, leaves completedAt null", () => {
  const now = new Date("2026-07-19T10:00:00Z");
  const result = resolveTaskTimestamps({ allDone: false, now, startedAt: null, completedAt: null });
  assert.equal(result.startedAt, now);
  assert.equal(result.completedAt, null);
});

test("resolveTaskTimestamps: startedAt never moves once set, even on the completing scan", () => {
  const started = new Date("2026-07-19T10:00:00Z");
  const now = new Date("2026-07-19T10:05:00Z");
  const result = resolveTaskTimestamps({ allDone: true, now, startedAt: started, completedAt: null });
  assert.equal(result.startedAt, started, "startedAt must stay pinned to the first scan");
  assert.equal(result.completedAt, now, "completedAt stamps on the scan that flips allDone true");
});

test("resolveTaskTimestamps: completedAt does not advance on a redundant scan of an already-complete task", () => {
  const started = new Date("2026-07-19T10:00:00Z");
  const completed = new Date("2026-07-19T10:05:00Z");
  const later = new Date("2026-07-19T10:10:00Z");
  // Simulates re-scanning an already-fulfilled SKU: quantities stay capped,
  // allDone is still (trivially) true, but completedAt must not be pushed
  // forward to `later`.
  const result = resolveTaskTimestamps({ allDone: true, now: later, startedAt: started, completedAt: completed });
  assert.equal(result.completedAt, completed, "completedAt must not advance past its first stamp");
  assert.equal(result.startedAt, started);
});

test("resolveTaskTimestamps: completedAt stays null while allDone is false, regardless of prior state", () => {
  const started = new Date("2026-07-19T10:00:00Z");
  const now = new Date("2026-07-19T10:05:00Z");
  const result = resolveTaskTimestamps({ allDone: false, now, startedAt: started, completedAt: null });
  assert.equal(result.completedAt, null);
});

// --- resolvePrimaryLocationCodes (isPrimary uniqueness invariant) -----------

test("resolvePrimaryLocationCodes: one isPrimary row per variant maps straight through", () => {
  const map = resolvePrimaryLocationCodes([
    { variantId: "v1", code: "A1-01" },
    { variantId: "v2", code: "B2-02" },
  ]);
  assert.equal(map.get("v1"), "A1-01");
  assert.equal(map.get("v2"), "B2-02");
  assert.equal(map.size, 2);
});

test("resolvePrimaryLocationCodes: when isPrimary is violated (two primaries for one variant), the FIRST (oldest, caller-ordered) row wins", () => {
  // Caller queries with `orderBy: { createdAt: "asc" }`, so this array
  // already represents oldest-first order — the dedup must keep the first
  // occurrence, not the last, and not overwrite it.
  const map = resolvePrimaryLocationCodes([
    { variantId: "v1", code: "OLDEST-A1" },
    { variantId: "v1", code: "NEWER-A2" },
    { variantId: "v1", code: "NEWEST-A3" },
  ]);
  assert.equal(map.get("v1"), "OLDEST-A1", "duplicate isPrimary rows must not overwrite the first-seen code");
  assert.equal(map.size, 1, "only one map entry per variant even with multiple isPrimary rows");
});

test("resolvePrimaryLocationCodes: distinct variants with duplicate primaries are each deduped independently", () => {
  const map = resolvePrimaryLocationCodes([
    { variantId: "v1", code: "A1-01" },
    { variantId: "v2", code: "B2-01" },
    { variantId: "v1", code: "A1-99-DUPLICATE" },
    { variantId: "v2", code: "B2-99-DUPLICATE" },
  ]);
  assert.equal(map.get("v1"), "A1-01");
  assert.equal(map.get("v2"), "B2-01");
  assert.equal(map.size, 2);
});

test("resolvePrimaryLocationCodes: empty input yields an empty map (variant has no primary location)", () => {
  const map = resolvePrimaryLocationCodes([]);
  assert.equal(map.size, 0);
});
