/**
 * Pure chip math for the tender panel's quick-cash controls (issue #41).
 *
 * Deliberately dependency-free, side-effect-free, and React-free so it can be
 * unit-tested in isolation. MONEY-CRITICAL: every comparison happens in
 * integer cents — raw float comparisons like `20 > 12.5` are fine, but the
 * general case (e.g. a 12.35 balance vs float denominations) must never
 * depend on binary floating-point equality.
 */

/**
 * Cash notes offered as one-tap "cover the bill" chips. The display currency
 * is currently hardcoded in format.ts ($); these are the matching US-style
 * paper denominations. Configurable per locale later (issue #41) via the
 * optional `denominations` argument of buildTenderChips.
 */
export const DEFAULT_TENDER_DENOMINATIONS: readonly number[] = [5, 10, 20, 50, 100];

export interface TenderChip {
  /** "exact" covers the balance precisely; "note" over-tends and yields change. */
  kind: "exact" | "note";
  /** Amount the chip puts into the tender field, at cent precision. */
  value: number;
  /** Preformatted display label for the chip. */
  label: string;
}

/** Rounds to cents with the half-up behaviour of Math.round on positives. */
function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function formatChipValue(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Builds the quick-tender chip list for a balance:
 * - always an exact-balance chip first (when the balance is collectible),
 * - then every denomination note STRICTLY GREATER than the balance,
 *   ascending — the "next-largest-note" change flow: tapping one tenders
 *   enough to close the order and shows change due. Notes smaller than the
 *   balance would under-tender and leave the order partially paid, so they
 *   are never offered; a note equal to the balance duplicates the exact chip
 *   and is skipped too.
 */
export function buildTenderChips(
  balanceDue: number,
  denominations: readonly number[] = DEFAULT_TENDER_DENOMINATIONS,
): TenderChip[] {
  const balanceCents = Math.round(balanceDue * 100);
  // Nothing to collect (settled/cancelled order) or garbage input: no chips,
  // and the panel's existing isValidAmount gate still rules the form.
  if (!Number.isFinite(balanceCents) || balanceCents <= 0) {
    return [];
  }

  const seen = new Set<number>();
  const noteCents = denominations
    .map((d) => Math.round(d * 100))
    .filter((cents) => {
      if (!Number.isFinite(cents) || cents <= balanceCents || seen.has(cents)) {
        return false;
      }
      seen.add(cents);
      return true;
    })
    .sort((a, b) => a - b);

  return [
    {
      kind: "exact",
      value: roundToCents(balanceCents / 100),
      label: `Exact ${formatChipValue(balanceCents)}`,
    },
    ...noteCents.map((cents) => ({
      kind: "note" as const,
      value: roundToCents(cents / 100),
      label: formatChipValue(cents),
    })),
  ];
}