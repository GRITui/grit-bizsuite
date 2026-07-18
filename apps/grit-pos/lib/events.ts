import "server-only";

import { createHash } from "node:crypto";
import { GritEventBus, buildEvent, type TransactionCompletedData } from "@grit/shared-events";
import { createNeonOutboxStore } from "@grit/database";

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
  cachedBus = databaseUrl
    ? new GritEventBus({ store: createNeonOutboxStore(databaseUrl) })
    : null;
  return cachedBus;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Envelope `organization_id` for a tenant. The platform outbox stores
 * organization_id as a uuid, but this app's tenant ids are cuids — so a
 * stable, deterministic UUID (v8-style, from sha256(tenantId)) is derived as
 * the SSO-bridge organization identifier until tenants are provisioned with
 * real platform org ids. A tenant id that already is a uuid passes through.
 */
export function eventOrganizationId(tenantId: string): string {
  if (UUID_RE.test(tenantId)) return tenantId;
  const hex = createHash("sha256").update(`grit-pos:${tenantId}`).digest("hex");
  // Stamp uuid version (8 = "custom") and RFC 4122 variant bits.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** Item shape the publisher needs from an order's lines. */
export interface CompletedOrderLine {
  productId: string;
  variantSku: string | null;
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
  lines: CompletedOrderLine[];
  /** True when the transaction was captured offline and synced later. */
  offlineSynced?: boolean;
}

/**
 * Publishes `transaction.completed` for an order that just became fully
 * paid/closed. Call AFTER the DB transaction has committed (e.g. from
 * `after()` in a route handler) — never awaited on the checkout path, and
 * never throws.
 *
 * Notes (per the platform contract):
 * - `location_id` is the tenant's id for now — this app has no Location
 *   model yet, so the tenant is the location.
 * - `tax_amount` is always 0 — there is no tax model in this schema yet.
 */
export async function publishTransactionCompleted(
  input: PublishTransactionCompletedInput,
): Promise<void> {
  try {
    const bus = getEventBus();
    if (!bus) return;

    const data: TransactionCompletedData = {
      transaction_id: input.orderId,
      location_id: input.tenantId,
      total_amount: input.totalAmount,
      tax_amount: 0,
      ...(input.offlineSynced ? { offline_synced: true } : {}),
      items: input.lines.map((line) => ({
        sku: eventItemSku(line),
        quantity: line.quantity,
        price: line.unitPrice,
      })),
    };

    await bus.publish(
      buildEvent("transaction.completed", eventOrganizationId(input.tenantId), data),
    );
  } catch (err) {
    // Fire-and-forget by contract: event delivery must never break checkout.
    console.error("Failed to publish transaction.completed", input.orderId, err);
  }
}
