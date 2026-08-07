import { NextResponse } from "next/server";
import { assertFeature } from "@grit/passport";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { entitlementResponse, requireGritContext } from "@/lib/passport";
import { generateTrackingRef } from "@/lib/labels/tracking-ref";
import { carrier } from "@/lib/carrier";
import type { ParcelLabel } from "@/generated/prisma/client";

/**
 * POST /api/orders/[id]/parcel-label — generate an internal parcel label.
 * Requires the order's pack task to exist and be `complete` (409
 * otherwise) — labeling happens only after the second (pack) scan pass
 * confirms contents. `trackingRef` is a self-generated internal reference
 * printed as a barcode on the HTML label (see the admin label page); it is
 * NOT a carrier tracking number.
 *
 * After the label row is created, we best-effort call the pluggable
 * carrier adapter (`src/lib/carrier/`, mock by default — see that
 * directory for how a real carrier plugs in) to create a shipment and
 * capture its `carrierTrackingId`/status on the same row. This mirrors the
 * "event publishing is fire-and-forget, never blocks the primary write"
 * convention used elsewhere (e.g. `apps/grit-pos/lib/events.ts`): a down or
 * misconfigured carrier must never prevent label creation.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireGritContext();
  try {
    assertFeature(ctx.grit, "inventory.multi_location");
  } catch (err) {
    const res = entitlementResponse(err);
    if (res) return res;
    throw err;
  }

  const { id } = await params;
  const order = await db.order.findFirst({
    where: { id, tenantId: ctx.local.tenantId },
    include: { lines: true, packTask: true },
  });
  if (!order) return apiError("Order not found", 404);
  if (!order.packTask || order.packTask.status !== "complete") {
    return apiError("Order's pack task is not complete yet", 409);
  }

  const itemCount = order.lines.reduce((sum, l) => sum + l.quantity, 0);

  // trackingRef is @unique; a collision is astronomically unlikely (10
  // hex-derived base36 chars) but retry a few times defensively rather than
  // ever surfacing a 500 to the picker.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const label = await db.parcelLabel.create({
        data: {
          tenantId: ctx.local.tenantId,
          orderId: order.id,
          trackingRef: generateTrackingRef(),
          toName: order.customerName,
          toAddress: order.customerAddress,
          itemCount,
          createdById: ctx.local.sub,
        },
      });

      const labelWithCarrier = await attachCarrierShipment(label);
      return NextResponse.json({ label: labelWithCarrier }, { status: 201 });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Best-effort: calls the active carrier adapter to create a shipment for a
 * freshly-created label and persists its `carrierTrackingId`/status on the
 * same row. Never throws — a carrier failure (or an unconfigured/down real
 * carrier once one is wired in) must never surface as a 500 to the picker,
 * so this catches everything and returns the original label unchanged on
 * any failure.
 */
async function attachCarrierShipment(label: ParcelLabel): Promise<ParcelLabel> {
  try {
    const shipment = await carrier.createShipment({
      toName: label.toName ?? "",
      toAddress: label.toAddress ?? "",
      weightKg: label.weightKg ? Number(label.weightKg) : undefined,
      itemCount: label.itemCount,
      trackingRef: label.trackingRef,
    });
    return await db.parcelLabel.update({
      where: { id: label.id },
      data: {
        carrierTrackingId: shipment.carrierTrackingId,
        carrierStatus: "created",
        carrierStatusUpdatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("Carrier createShipment failed, label still created", label.id, err);
    return label;
  }
}
