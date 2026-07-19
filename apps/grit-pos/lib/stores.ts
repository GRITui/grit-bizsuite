import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Resolves the Store id that a `transaction.completed` event's `location_id`
 * should carry for a given order.
 *
 * - If the order already has a `storeId` (no checkout flow sets one yet, but
 *   a future stage may), use it directly.
 * - Otherwise, resolve to the tenant's default Store (`isDefault = true`,
 *   oldest first if more than one is somehow marked default) — this is the
 *   normal path today, and matches grit-inventory's own "no specific store"
 *   resolution (app/api/events/grit/route.ts) so single-location tenants
 *   round-trip through a real Store id instead of the old tenant-id stand-in.
 * - If the tenant somehow has no Store row at all (shouldn't happen: every
 *   tenant gets a default Store via the Store migration's backfill, and
 *   nothing deletes it), fall back to the tenant id — the previous stand-in
 *   behavior — so publishing never breaks over a missing lookup.
 */
export async function resolveOrderStoreId(
  tenantId: string,
  storeId: string | null | undefined,
): Promise<string> {
  if (storeId) return storeId;

  const defaultStore = await prisma.store.findFirst({
    where: { tenantId, isDefault: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  return defaultStore?.id ?? tenantId;
}
