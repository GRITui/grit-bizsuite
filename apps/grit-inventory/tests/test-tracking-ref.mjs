// grit-inventory — tests/test-tracking-ref.mjs
//
// Covers src/lib/labels/tracking-ref.ts (`generateTrackingRef`), extracted
// (no behavior change) from
// src/app/api/orders/[id]/parcel-label/route.ts so the format that ends up
// encoded into the parcel label's Code 128 barcode is unit-testable
// without a live DB.

import assert from "node:assert/strict";
import test from "node:test";

import { generateTrackingRef } from "../src/lib/labels/tracking-ref.ts";

test("generateTrackingRef: matches the PKG-<10 uppercase base16-ish chars> format", () => {
  const ref = generateTrackingRef();
  assert.match(ref, /^PKG-[0-9A-F]{10}$/);
});

test("generateTrackingRef: is exactly 14 characters (PKG- + 10)", () => {
  const ref = generateTrackingRef();
  assert.equal(ref.length, 14);
});

test("generateTrackingRef: contains only printable-ASCII characters valid for Code128B", () => {
  const ref = generateTrackingRef();
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    assert.ok(code >= 32 && code <= 127, `character ${JSON.stringify(ch)} must be Code128B-safe`);
  }
});

test("generateTrackingRef: produces distinct refs across many calls (no collisions in a reasonable sample)", () => {
  const seen = new Set();
  const n = 500;
  for (let i = 0; i < n; i++) {
    seen.add(generateTrackingRef());
  }
  assert.equal(seen.size, n, "all generated refs should be unique in a 500-sample run");
});

test("generateTrackingRef: never contains hyphens beyond the fixed PKG- prefix", () => {
  // The UUID's hyphens are stripped before slicing, so the only hyphen in
  // the output should be the one separating "PKG" from the token.
  for (let i = 0; i < 50; i++) {
    const ref = generateTrackingRef();
    assert.equal(ref.indexOf("-"), 3, `unexpected hyphen position in ${ref}`);
    assert.equal(ref.lastIndexOf("-"), 3, `extra hyphen found in ${ref}`);
  }
});
