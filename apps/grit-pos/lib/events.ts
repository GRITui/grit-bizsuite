import "server-only";

import {
  GritEventBus,
  buildEvent,
  type GritEvent,
  type OutboxStore,
  type PublishResult,
  type TransactionCompletedData,
} from "@grit/shared-events";
import { prisma } from "@/lib/prisma";
import { resolveOrderStoreId } from "@/lib/stores";

// ---------------------------------------------------------------------------
// Outbound Grit BizSuite events (transaction.completed, pos.velocity_surge).
//
// Everything here is fire-and-forget and lazily configured: checkout must
// NEVER block or fail because event plumbing is missing or down. With no
// GRIT_SUBSCRIBERS_* env vars set, publishing simply records to the outbox
// (if DATABASE_URL is set) and delivers to zero subscribers; with nothing
// configured at all it degrades to a logged no-op.
// ---------------------------------------------------------------------------

let cachedBus: GritEventBus | null | undefined;

/**
 * Lazily builds the shared event bus. The outbox store reuses this app's own
 * DATABASE_URL (the `event_outbox` table ships in this app's migration,
 * mirroring @grit/database). Returns null only when DATABASE_URL is unset —
 * in that case there is nowhere durable to record events, so publishing is
 * skipped entirely rather than crashing.
 */
export function getEventBus(): GritEventBus | null {
  if (cachedBus !== undefined) return cachedBus;
  const databaseUrl = process.env.DATABASE_URL;
  cachedBus = databaseUrl ? new GritEventBus({ store: prismaOutboxStore() }) : null;
  return cachedBus;
}

/**
 * Outbox store backed by this app's own Prisma client (EventOutbox model →
 * event_outbox table, canonical @grit/database shape). One DB driver
 * everywhere: the Neon adapter on deploys, the node-postgres fallback in
 * local dev — instead of the package's separate Neon-HTTP store, which
 * cannot reach a plain local Postgres.
 */
function prismaOutboxStore(): OutboxStore {
  return {
    async save(event: GritEvent) {
      await prisma.eventOutbox.upsert({
        where: { eventId: event.event_id },
        update: {},
        create: {
          eventId: event.event_id,
          eventName: event.event,
          organizationId: event.organization_id,
          payload: event as unknown as object,
          createdAt: new Date(event.timestamp),
        },
      });
    },
    async markDelivered(eventId: string) {
      await prisma.eventOutbox.updateMany({
        where: { eventId },
        data: { deliveredAt: new Date() },
      });
    },
    async listUndelivered(limit: number) {
      const rows = await prisma.eventOutbox.findMany({
        where: { deliveredAt: null },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      return rows.map((r) => r.payload as unknown as GritEvent);
    },
  };
}

/** Item shape the publisher needs from an order's lines. */
export interface CompletedOrderLine {
  productId: string;
  variantSku: string | null;
  /**
   * Inventory's canonical Variant id (`Variant.inventoryVariantId`), once
   * backfilled by the inbound `catalog.variant_synced` webhook (see
   * app/api/events/grit/route.ts). Omitted from the outbound event entirely
   * when null/undefined — see `publishTransactionCompleted` below.
   */
  variantInventoryId?: string | null;
  quantity: number;
  unitPrice: number;
}

/** sku for an event item: the variant's child SKU, else a product fallback. */
export function eventItemSku(line: Pick<CompletedOrderLine, "productId" | "variantSku">): string {
  return line.variantSku ?? `PRD-${line.productId}`;
}

export interface PublishTransactionCompletedInput {
  tenantId: string;
  orderId: string;
  totalAmount: number;
  /**
   * VAT embedded in `totalAmount` (Thailand VAT-inclusive pricing — see
   * BACKLOG.md "VAT-inclusive pricing"), derived from each line's
   * Variant.vatApplicable flag and the tenant's Tenant.vatRate. Callers
   * should compute this the same way `OrderDTO.vatAmount` is derived (see
   * `computeOrderVat` in app/api/orders/_lib/queries.ts) so the event and
   * the receipt always agree.
   */
  taxAmount: number;
  lines: CompletedOrderLine[];
  /** True when the transaction was captured offline and synced later. */
  offlineSynced?: boolean;
  /**
   * The order's Store id, if known (`Order.storeId`). No checkout flow sets
   * this yet, so callers typically omit it/pass null — `location_id` then
   * resolves to the tenant's default Store (see `resolveOrderStoreId`).
   */
  storeId?: string | null;
}

/**
 * Publishes `transaction.completed` for an order that just became fully
 * paid/closed. Call AFTER the DB transaction has committed (e.g. from
 * `after()` in a route handler) — never awaited on the checkout path, and
 * never throws.
 *
 * Returns the bus's `PublishResult` (subscriber count vs. delivered count,
 * per-URL failures) so callers can observe partial delivery failures — see
 * `packages/shared-events/src/bus.ts`. Returns `null` when there was no bus
 * to publish to (no DATABASE_URL) or when publishing itself threw; either
 * way this function never throws and checkout must never branch on the
 * result — it's for observability (logging) only, never control flow.
 *
 * Notes (per the platform contract):
 * - `location_id` is the order's real Store id (`resolveOrderStoreId`):
 *   `input.storeId` if the order has one, else the tenant's default Store,
 *   else (only if the tenant somehow has no Store row) the tenant id itself
 *   as a last-resort stand-in — see lib/stores.ts.
 * - `tax_amount` is the VAT embedded in `totalAmount`, computed by the
 *   caller from the order's lines (Variant.vatApplicable) and the tenant's
 *   Tenant.vatRate — see `PublishTransactionCompletedInput.taxAmount`.
 * - Envelope `organization_id` is the raw tenant id (a cuid): the platform
 *   outbox stores `organization_id` as opaque text, and grit-inventory maps
 *   it back to `Tenant.id` by equality, so no id translation is needed.
 */
export async function publishTransactionCompleted(
  input: PublishTransactionCompletedInput,
): Promise<PublishResult | null> {
  try {
    const bus = getEventBus();
    if (!bus) return null;

    const locationId = await resolveOrderStoreId(input.tenantId, input.storeId);

    const data: TransactionCompletedData = {
      transaction_id: input.orderId,
      location_id: locationId,
      total_amount: input.totalAmount,
      tax_amount: input.taxAmount,
      ...(input.offlineSynced ? { offline_synced: true } : {}),
      items: input.lines.map((line) => ({
        sku: eventItemSku(line),
        quantity: line.quantity,
        price: line.unitPrice,
        ...(line.variantInventoryId ? { inventory_variant_id: line.variantInventoryId } : {}),
      })),
    };

    return await bus.publish(buildEvent("transaction.completed", input.tenantId, data));
  } catch (err) {
    // Fire-and-forget by contract: event delivery must never break checkout.
    console.error("Failed to publish transaction.completed", input.orderId, err);
    return null;
  }
}

/**
 * Logs a structured warning when a `publishTransactionCompleted` result
 * shows one or more subscribers failed delivery. Non-blocking observability
 * only — never throws, never affects checkout. Callers should invoke this
 * with the `PublishResult` returned by `publishTransactionCompleted` right
 * after awaiting it.
 */
export function warnOnPublishFailures(orderId: string, result: PublishResult | null): void {
  if (!result || result.failures.length === 0) return;
  console.warn("transaction.completed delivery incomplete", {
    orderId,
    eventId: result.event_id,
    subscribers: result.subscribers,
    delivered: result.delivered,
    failures: result.failures,
  });
}
