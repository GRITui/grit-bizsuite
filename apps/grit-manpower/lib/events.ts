import type { GritEvent, GritEventName, ManpowerShiftUnassignedData } from "@grit/shared-events/contracts";

/**
 * Outbound event publishing for grit-manpower, built on @grit/shared-events
 * (HMAC-signed internal webhooks). Mirrors the wrapper shape
 * apps/grit-inventory/src/lib/events.ts uses for its own outbound events —
 * see that file for the fuller rationale on the `require()` binding below.
 *
 * Unlike grit-inventory, this app's Prisma schema has no `EventOutbox`
 * model yet (adding one is a schema migration, out of scope for this pass —
 * see AGENTS.md task notes), so the bus always runs WITHOUT a durable
 * outbox store: publishing is best-effort webhook delivery only. If an event
 * fails to deliver right now, it's simply lost (logged, not thrown) rather
 * than retried later — acceptable for `manpower.shift_unassigned` today
 * since Taskboard is a convenience nudge, not the system of record for
 * unassigned shifts (the Shift table itself remains authoritative).
 *
 * Degrades gracefully when unconfigured:
 * - No `GRIT_EVENT_WEBHOOK_SECRET` / no `GRIT_SUBSCRIBERS_*` URLs -> nothing
 *   is delivered; publishes are inert.
 * - Any publish failure is logged and swallowed, never thrown — event
 *   emission must never break the business operation that triggered it.
 */

/** Structural mirror of `PublishResult` from @grit/shared-events. */
export interface PublishResultLike {
  event_id: string;
  subscribers: number;
  delivered: number;
  failures: Array<{ url: string; error: string }>;
}

/** Structural mirror of the `GritEventBus` public surface. */
export interface GritEventBusLike {
  publish(event: GritEvent): Promise<PublishResultLike>;
  drainOutbox(limit?: number): Promise<PublishResultLike[]>;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const sharedEvents = require("@grit/shared-events") as {
  GritEventBus: new (options?: { webhookSecret?: string }) => GritEventBusLike;
  buildEvent: <D>(
    event: GritEventName,
    organizationId: string,
    data: D,
    now?: Date,
  ) => GritEvent;
};
/* eslint-enable @typescript-eslint/no-require-imports */

let bus: GritEventBusLike | null = null;

/** Lazily constructed singleton bus — env is only read at first use. */
export function getEventBus(): GritEventBusLike {
  if (!bus) {
    bus = new sharedEvents.GritEventBus();
  }
  return bus;
}

/** Publish, tolerating every failure — event emission must never break the
 * business operation that triggered it. */
export async function publishEventSafe(event: GritEvent): Promise<void> {
  try {
    await getEventBus().publish(event);
  } catch (err) {
    console.warn(`[events] publish failed for ${event.event} (${event.event_id}):`, err);
  }
}

/**
 * Published whenever a Shift is created or updated and ends up with no
 * `employeeId` — see ManpowerShiftUnassignedData's docstring in
 * @grit/shared-events/contracts for why (Taskboard automation surfaces the
 * gap as a card instead of it staying buried in a schedule screen).
 */
export async function publishShiftUnassigned(
  organizationId: string,
  data: ManpowerShiftUnassignedData,
): Promise<void> {
  await publishEventSafe(
    sharedEvents.buildEvent("manpower.shift_unassigned", organizationId, data),
  );
}
