import { randomUUID } from "node:crypto";

/**
 * `PKG-` + a cuid-ish short random token, e.g. `PKG-A1B2C3D4E5`.
 *
 * Extracted (no behavior change) from
 * `src/app/api/orders/[id]/parcel-label/route.ts` so it's unit-testable
 * without a live DB.
 */
export function generateTrackingRef(): string {
  return `PKG-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}
