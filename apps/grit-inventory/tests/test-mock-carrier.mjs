// grit-inventory — tests/test-mock-carrier.mjs
//
// Covers src/lib/carrier/mockCarrier.ts: the dependency-free simulated
// carrier adapter used when CARRIER_PROVIDER is unset ("mock" default —
// see src/lib/carrier/index.ts). No DB, no network — the mock carrier
// encodes its own creation timestamp into the tracking id and derives
// status purely from elapsed wall-clock time, so these tests exercise that
// derivation directly via Date mocking rather than real sleeps.

import assert from "node:assert/strict";
import test from "node:test";

import { mockCarrier } from "../src/lib/carrier/mockCarrier.ts";

test("createShipment: mints a MOCK-prefixed tracking id, no labelUrl", async () => {
  const result = await mockCarrier.createShipment({
    toName: "Jane Doe",
    toAddress: "123 Main St",
    itemCount: 2,
    trackingRef: "PKG-AAAAAAAAAA",
  });
  assert.match(result.carrierTrackingId, /^MOCK-[0-9A-Z]+-[0-9A-Z]{8}$/);
  assert.equal(result.labelUrl, undefined);
});

test("createShipment: produces distinct ids across calls", async () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const r = await mockCarrier.createShipment({
      toName: "A",
      toAddress: "B",
      itemCount: 1,
      trackingRef: `PKG-${i}`,
    });
    ids.add(r.carrierTrackingId);
  }
  assert.equal(ids.size, 50);
});

test("getTrackingStatus: reports 'created' immediately after creation", async () => {
  const { carrierTrackingId } = await mockCarrier.createShipment({
    toName: "A",
    toAddress: "B",
    itemCount: 1,
    trackingRef: "PKG-NOW",
  });
  const status = await mockCarrier.getTrackingStatus(carrierTrackingId);
  assert.equal(status.status, "created");
  assert.ok(status.lastUpdatedAt);
});

test("getTrackingStatus: advances to 'in_transit' after the created window elapses", async () => {
  // Build an id as if it were created 5 minutes ago (past the 2-minute
  // "created" window, inside the 10-minute "in_transit" window).
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const epoch36 = fiveMinAgo.toString(36).toUpperCase();
  const id = `MOCK-${epoch36}-AAAAAAAA`;
  const status = await mockCarrier.getTrackingStatus(id);
  assert.equal(status.status, "in_transit");
});

test("getTrackingStatus: advances to 'delivered' (or a deterministic 'exception') after the in-transit window elapses", async () => {
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const epoch36 = thirtyMinAgo.toString(36).toUpperCase();
  const id = `MOCK-${epoch36}-BBBBBBBB`;
  const status = await mockCarrier.getTrackingStatus(id);
  assert.ok(["delivered", "exception"].includes(status.status));
});

test("getTrackingStatus: is deterministic for the same id (repeat calls agree, once past a stable window)", async () => {
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const epoch36 = thirtyMinAgo.toString(36).toUpperCase();
  const id = `MOCK-${epoch36}-CCCCCCCC`;
  const first = await mockCarrier.getTrackingStatus(id);
  const second = await mockCarrier.getTrackingStatus(id);
  assert.equal(first.status, second.status);
});

test("getTrackingStatus: degrades to 'exception' for an unrecognized id shape rather than throwing", async () => {
  const status = await mockCarrier.getTrackingStatus("NOT-A-MOCK-ID");
  assert.equal(status.status, "exception");
});
