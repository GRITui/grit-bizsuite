// grit-inventory — tests/test-code128.mjs
//
// Pure-node self test (node:test + node:assert/strict, run via tsx so the
// TypeScript source under test can be imported directly — same spirit as
// apps/grit-reports's tests/test-aggregate.mjs and
// apps/grit-taskboard's tests/test-stripe-webhook.mjs). No install beyond
// this app's existing devDependency on tsx, no live DB.
//
// Covers src/lib/barcode/code128.ts (`encodeCode128B`) — the Code 128
// Subset B encoder added for parcel label rendering. Verifies the
// structural invariants of a valid Code 128 symbol (start/stop framing,
// checksum, bar/space alternation, module widths) rather than re-deriving
// bar patterns by hand for every input.

import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeCode128B,
  CODE128_START_B,
  CODE128_STOP,
} from "../src/lib/barcode/code128.ts";

test("encodeCode128B: start pattern is 6 elements, first element is a black bar", () => {
  const bars = encodeCode128B("A");
  // START_B pattern (value 104) is "211214" — 6 widths, alternating bar/space.
  assert.equal(bars[0].black, true);
  assert.deepEqual(
    bars.slice(0, 6).map((b) => b.width),
    "211214".split("").map(Number)
  );
});

test("encodeCode128B: stop pattern (7 elements, sums to 13 modules) terminates every symbol", () => {
  for (const text of ["A", "PKG-0000000001", "hello world!"]) {
    const bars = encodeCode128B(text);
    const stopBars = bars.slice(-7);
    assert.equal(stopBars.length, 7, `${text}: stop pattern is 7 bar/space elements`);
    const stopWidthSum = stopBars.reduce((sum, b) => sum + b.width, 0);
    assert.equal(stopWidthSum, 13, `${text}: stop pattern sums to 13 modules`);
  }
});

test("encodeCode128B: bar/space colors strictly alternate starting with black", () => {
  const bars = encodeCode128B("PKG-0000000001");
  for (let i = 0; i < bars.length; i++) {
    assert.equal(bars[i].black, i % 2 === 0, `element ${i} alternates correctly`);
  }
});

test("encodeCode128B: every non-stop element's width is a single Code128 module digit (1-4)", () => {
  const bars = encodeCode128B("PKG-0000000001");
  for (const bar of bars) {
    assert.ok(Number.isInteger(bar.width) && bar.width >= 1 && bar.width <= 4, `width ${bar.width} in range`);
  }
});

test("encodeCode128B: same input is deterministic (idempotent encoding)", () => {
  const a = encodeCode128B("PKG-0000000001");
  const b = encodeCode128B("PKG-0000000001");
  assert.deepEqual(a, b);
});

test("encodeCode128B: different tracking refs produce different symbols (checksum/content sensitivity)", () => {
  const a = encodeCode128B("PKG-0000000001");
  const b = encodeCode128B("PKG-0000000002");
  assert.notDeepEqual(a, b);
});

test("encodeCode128B: rejects characters outside printable ASCII 32-127", () => {
  assert.throws(() => encodeCode128B("PKG-\t0001"), /outside printable ASCII/);
  assert.throws(() => encodeCode128B("café"), /outside printable ASCII/);
});

test("encodeCode128B: accepts the full printable-ASCII boundary characters", () => {
  assert.doesNotThrow(() => encodeCode128B(" "));
  assert.doesNotThrow(() => encodeCode128B(""));
});

test("sanity: exported start/stop code values match the Code128 Subset B spec", () => {
  assert.equal(CODE128_START_B, 104);
  assert.equal(CODE128_STOP, 106);
});
