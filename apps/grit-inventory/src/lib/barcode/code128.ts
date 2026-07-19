/**
 * Minimal Code 128 (Subset B) encoder.
 *
 * Vendored rather than pulling in an npm dependency (see package.json — no
 * existing barcode/QR library is present). Implements the public-domain
 * Code 128 symbology as specified by ISO/IEC 15417: Subset B covers all
 * printable ASCII (0x20-0x7F), which is sufficient for the `PKG-XXXXXXXXXX`
 * tracking refs this app generates (see
 * `src/app/api/orders/[id]/parcel-label/route.ts`).
 *
 * Encoding scheme:
 *  - START_B (value 104), one code value per input character
 *    (`charCode - 32`), a mod-103 checksum, then STOP.
 *  - Each code value maps to an 11-module bar/space pattern (the STOP
 *    pattern has a trailing bar and is 13 modules) via `PATTERNS` below,
 *    the standard Code 128 pattern table.
 *
 * `encodeCode128B` returns the sequence of bar/space widths (in modules) so
 * callers can render them as SVG rects, canvas fills, etc. The first
 * element is always a bar (black); widths alternate bar/space/bar/...
 * thereafter.
 */

export const CODE128_START_B = 104;
export const CODE128_STOP = 106;

/**
 * Module-width patterns for code values 0-106, each a string of digits
 * (bar, space, bar, space, bar, space, ...) summing to 11 modules — except
 * the STOP pattern (index 106), which has an extra trailing bar and sums
 * to 13 modules, per the Code 128 specification.
 */
const PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export interface Code128Bar {
  /** Width of this element, in barcode modules (narrow-bar units). */
  width: number;
  /** True if this element is a printed (black) bar; false if it's a gap. */
  black: boolean;
}

/**
 * Encode `text` (must be within printable ASCII 0x20-0x7F) as a Code 128
 * Subset B bar/space sequence, including start, checksum, and stop.
 */
export function encodeCode128B(text: string): Code128Bar[] {
  const values: number[] = [CODE128_START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 127) {
      throw new Error(`Code128B: character ${JSON.stringify(ch)} is outside printable ASCII 32-127`);
    }
    values.push(code - 32);
  }

  let checksum = values[0];
  for (let i = 1; i < values.length; i++) {
    checksum += values[i] * i;
  }
  values.push(checksum % 103);
  values.push(CODE128_STOP);

  const bars: Code128Bar[] = [];
  for (const value of values) {
    const pattern = PATTERNS[value];
    for (let i = 0; i < pattern.length; i++) {
      bars.push({ width: Number(pattern[i]), black: i % 2 === 0 });
    }
  }
  return bars;
}
