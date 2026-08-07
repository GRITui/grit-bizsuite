/**
 * Carrier-agnostic shipping interface.
 *
 * No real carrier (FedEx/UPS/USPS/etc.) is wired in yet — see
 * `src/lib/carrier/index.ts` for how a real adapter plugs in later. Every
 * adapter implementing this interface must:
 *
 *   - never throw at import time for a missing/invalid credential (only at
 *     call time, and even then callers treat carrier failures as
 *     best-effort — see the parcel-label route);
 *   - be safe to call repeatedly (idempotency is the adapter's concern, not
 *     the caller's).
 */

/** Input to `CarrierAdapter.createShipment`. */
export interface CreateShipmentInput {
  toName: string;
  toAddress: string;
  weightKg?: number;
  itemCount: number;
  /**
   * This app's own internal tracking ref (`generateTrackingRef()`, e.g.
   * `PKG-A1B2C3D4E5`) — NOT a carrier tracking number. Adapters may use it
   * as an idempotency key / order reference with the carrier, but must
   * mint and return their own `carrierTrackingId`.
   */
  trackingRef: string;
}

/** Result of `CarrierAdapter.createShipment`. */
export interface CreateShipmentResult {
  /** The carrier's own tracking number/id (never the internal trackingRef). */
  carrierTrackingId: string;
  /** URL to a carrier-hosted label image/PDF, when the carrier provides one. */
  labelUrl?: string;
}

/** Carrier-normalized shipment status, as returned by `getTrackingStatus`. */
export type CarrierTrackingStatusValue = "created" | "in_transit" | "delivered" | "exception";

/** Result of `CarrierAdapter.getTrackingStatus`. */
export interface TrackingStatusResult {
  status: CarrierTrackingStatusValue;
  /** ISO-8601 timestamp of the status snapshot. */
  lastUpdatedAt: string;
  description?: string;
}

/**
 * Implement this to add a new carrier. See `src/lib/carrier/index.ts` for
 * the selector that wires an adapter in behind `CARRIER_PROVIDER`, and
 * `src/lib/carrier/mockCarrier.ts` for a reference implementation with no
 * external dependencies.
 */
export interface CarrierAdapter {
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  getTrackingStatus(carrierTrackingId: string): Promise<TrackingStatusResult>;
}
