// Pure sibling-reorder logic shared by /api/item-groups/[id] and
// /api/item-sub-groups/[id] PATCH handlers. Both routes swap `sortOrder`
// with the previous/next sibling (ordered by sortOrder asc, then createdAt
// asc) when asked to move a row "up" or "down". Extracted here so the swap
// decision — which two rows change places, and when a move is a no-op
// (already first/last, or the target isn't in the list) — is unit-testable
// without a live Prisma/Postgres connection.

export type SortableSibling = { id: string; sortOrder: number };

export type ReorderSwap<T extends SortableSibling> = {
  current: T;
  swapWith: T;
};

/**
 * Given a list of siblings already ordered the way the UI/DB presents them,
 * decide which two rows must swap `sortOrder` to move `targetId` one step
 * "up" (earlier in the list) or "down" (later in the list).
 *
 * Returns `null` when there's nothing to do: `targetId` isn't present in the
 * list, or the move would go past either end (moving the first row up, or
 * the last row down) — mirrors the route handlers' `if (... ) return;`
 * early-out inside the transaction.
 */
export function resolveReorderSwap<T extends SortableSibling>(
  siblings: T[],
  targetId: string,
  direction: "up" | "down"
): ReorderSwap<T> | null {
  const idx = siblings.findIndex((s) => s.id === targetId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= siblings.length) return null;
  return { current: siblings[idx], swapWith: siblings[swapIdx] };
}
