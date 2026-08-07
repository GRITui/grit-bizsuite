import { randomBytes } from "node:crypto";
import type {
  CarrierAdapter,
  CreateShipmentInput,
  CreateShipmentResult,
  TrackingStatusResult,
} from "@/lib/carrier/types";

/**
 * Deterministic, dependency-free mock carrier.
 *
 * No external API, no credentials, no background job. `createShipment`
 * mints a fake-but-realistic tracking id that embeds its own creation
 * timestamp (base36-encoded); `getTrackingStatus` decodes that timestamp
 * back out and derives a status purely from elapsed wall-clock time. This
 * means the "carrier state" this adapter needs lives entirely in the id
 * string itself — the caller is responsible for persisting that id
 * (`ParcelLabel.carrierTrackingId`, see the parcel-label route), not this
 * module.
 *
 * Timeline (tuned short so the progression is observable within a single
 * demo/dev session rather than requiring real-world shipping days):
 *   0m   – 2m   : "created"
 *   2m   – 10m  : "in_transit"
 *   10m+         : "delivered" (or "exception" for a fixed ~1-in-17 slice
 *                  of ids, chosen deterministically from the id itself so
 *                  repeated calls for the same shipment are stable)
 */

const CREATED_WINDOW_MS = 2 * 60 * 1000;
const IN_TRANSIT_WINDOW_MS = 10 * 60 * 1000;

const ID_PREFIX = "MOCK";

function randomAlphanumeric(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"; // no O/I to avoid look-alikes
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Cheap deterministic hash of a string into a small non-negative int. */
function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function encodeCreatedAt(date: Date): string {
  return date.getTime().toString(36).toUpperCase();
}

/** Returns null if `carrierTrackingId` wasn't minted by this adapter. */
function decodeCreatedAt(carrierTrackingId: string): Date | null {
  const parts = carrierTrackingId.split("-");
  if (parts.length !== 3 || parts[0] !== ID_PREFIX) return null;
  const ms = parseInt(parts[1], 36);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

async function createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  void input; // mock carrier doesn't call out anywhere; input is accepted for interface parity
  const now = new Date();
  const carrierTrackingId = `${ID_PREFIX}-${encodeCreatedAt(now)}-${randomAlphanumeric(8)}`;
  return { carrierTrackingId };
}

async function getTrackingStatus(carrierTrackingId: string): Promise<TrackingStatusResult> {
  const createdAt = decodeCreatedAt(carrierTrackingId);
  const now = new Date();

  // Unknown/foreign id shape (e.g. looked up against the wrong adapter):
  // degrade to a reported exception rather than throwing, so a caller that
  // races an adapter switch never crashes on a stale tracking id.
  if (!createdAt) {
    return {
      status: "exception",
      lastUpdatedAt: now.toISOString(),
      description: "Unrecognized tracking id for the mock carrier",
    };
  }

  const elapsedMs = now.getTime() - createdAt.getTime();
  const isExceptionSlice = hashCode(carrierTrackingId) % 17 === 0;

  if (elapsedMs < CREATED_WINDOW_MS) {
    return {
      status: "created",
      lastUpdatedAt: now.toISOString(),
      description: "Label created, awaiting carrier pickup",
    };
  }
  if (elapsedMs < IN_TRANSIT_WINDOW_MS) {
    return {
      status: "in_transit",
      lastUpdatedAt: now.toISOString(),
      description: "Package is in transit",
    };
  }
  if (isExceptionSlice) {
    return {
      status: "exception",
      lastUpdatedAt: now.toISOString(),
      description: "Carrier reported a delivery exception",
    };
  }
  return {
    status: "delivered",
    lastUpdatedAt: now.toISOString(),
    description: "Package delivered",
  };
}

export const mockCarrier: CarrierAdapter = { createShipment, getTrackingStatus };
