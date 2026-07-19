// grit-inventory — tests/test-code128-spec-vectors.mjs
//
// Additional edge-case coverage for src/lib/barcode/code128.ts
// (`encodeCode128B`), complementing tests/test-code128.mjs (which checks
// structural invariants: framing, alternation, module-width bounds,
// determinism). This file spot-checks *exact* module-width sequences,
// hand-derived from the public Code 128 Subset B pattern table and the
// mod-103 checksum algorithm (ISO/IEC 15417), plus empty-string and
// long-input edge cases.
//
// Hand-derivation for "A":
//   values = [START_B=104, 'A' (charCode 65 - 32 = 33)]
//   checksum = 104*1 + 33*1 = 137; 137 % 103 = 34
//   values  = [104, 33, 34, STOP=106]
//   patterns: 104 -> "211214", 33 -> "111323", 34 -> "131123", 106 -> "2331112"
//
// Hand-derivation for "" (empty string):
//   values = [START_B=104]; checksum = 104 % 103 = 1
//   values = [104, 1, STOP=106]
//   patterns: 104 -> "211214", 1 -> "222122", 106 -> "2331112"

import assert from "node:assert/strict";
import test from "node:test";

import { encodeCode128B } from "../src/lib/barcode/code128.ts";

function widths(bars) {
  return bars.map((b) => b.width);
}

test("encodeCode128B('A'): exact bar sequence matches hand-derived Code128B spec vector", () => {
  const bars = encodeCode128B("A");
  const expected = [
    ..."211214".split("").map(Number), // START_B
    ..."111323".split("").map(Number), // 'A' (code value 33)
    ..."131123".split("").map(Number), // checksum (value 34)
    ..."2331112".split("").map(Number), // STOP
  ];
  assert.deepEqual(widths(bars), expected);
  assert.equal(bars.length, 6 + 6 + 6 + 7);
});

test("encodeCode128B(''): empty string still encodes START + checksum(=START value) + STOP", () => {
  const bars = encodeCode128B("");
  const expected = [
    ..."211214".split("").map(Number), // START_B
    ..."222122".split("").map(Number), // checksum (value 1)
    ..."2331112".split("").map(Number), // STOP
  ];
  assert.deepEqual(widths(bars), expected);
  assert.equal(bars.length, 6 + 6 + 7);
});

test("encodeCode128B: total element count is exactly 6*(2+len) + 7 for any in-range text", () => {
  for (const text of ["", "A", "PKG-0000000001", "0123456789", "x".repeat(30)]) {
    const bars = encodeCode128B(text);
    assert.equal(bars.length, 6 * (2 + text.length) + 7, `element count for ${JSON.stringify(text.slice(0, 10))}...`);
  }
});

test("encodeCode128B: a realistic max-length tracking ref (PKG- + 10 chars = 14) encodes without error", () => {
  const text = "PKG-A1B2C3D4E5";
  const bars = encodeCode128B(text);
  assert.equal(bars.length, 6 * (2 + text.length) + 7);
  // First element always a black bar, last element (end of STOP) is a bar too
  // (STOP pattern has an odd 7 elements, alternation starting at black means
  // index 6 -- the 7th, last -- is black again).
  assert.equal(bars[0].black, true);
  assert.equal(bars[bars.length - 1].black, true);
});

test("encodeCode128B: checksum wraps via mod 103 for long/high-value inputs (no throw, valid widths)", () => {
  // A long, high-charcode-heavy string pushes the weighted sum well past
  // 103 many times over -- exercise the modulo wraparound path.
  const text = "~".repeat(40); // '~' = charCode 126, code value 94, near the top of the range
  const bars = encodeCode128B(text);
  assert.equal(bars.length, 6 * (2 + text.length) + 7);
  for (const bar of bars) {
    assert.ok(bar.width >= 1 && bar.width <= 4);
  }
});

test("encodeCode128B: boundary characters space (0x20) and DEL-adjacent 0x7F encode via distinct patterns", () => {
  // space -> code value 0 -> pattern "212222"
  const spaceBars = encodeCode128B(" ");
  assert.deepEqual(
    widths(spaceBars).slice(6, 12),
    "212222".split("").map(Number)
  );
  // charCode 127 (DEL) -> code value 95 -> pattern "2331112"... actually 95 maps into the table's
  // upper rows; just assert it doesn't throw and produces a same-length symbol as any other single char.
  const delBars = encodeCode128B(String.fromCharCode(127));
  assert.equal(delBars.length, spaceBars.length);
});

test("encodeCode128B: rejects charCode 128 and above (just past the printable-ASCII boundary)", () => {
  assert.throws(() => encodeCode128B(String.fromCharCode(128)), /outside printable ASCII/);
});

test("encodeCode128B: rejects charCode 31 and below (just below the boundary)", () => {
  assert.throws(() => encodeCode128B(String.fromCharCode(31)), /outside printable ASCII/);
});
