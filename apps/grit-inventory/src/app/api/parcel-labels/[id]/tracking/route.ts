import { NextResponse } from "next/server";
import { assertFeature } from "@grit/passport";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { entitlementResponse, requireGritContext } from "@/lib/passport";
import { carrier } from "@/lib/carrier";

/**
 * GET /api/parcel-labels/[id]/tracking — live carrier tracking status.
 *
 * Calls the active carrier adapter's `getTrackingStatus` for the label's
 * `carrierTrackingId` and refreshes `carrierStatus`/`carrierStatusUpdatedAt`
 * on the row so the admin label page's next render reflects it without a
 * second round trip. If the label has no `carrierTrackingId` yet (the
 * create-time carrier call failed or hasn't run), returns the label as-is
 * with `carrierStatus: null` rather than erroring — this endpoint is a
 * best-effort refresh, not a required step.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireGritContext();
  try {
    assertFeature(ctx.grit, "inventory.multi_location");
  } catch (err) {
    const res = entitlementResponse(err);
    if (res) return res;
    throw err;
  }

  const { id } = await params;
  const label = await db.parcelLabel.findFirst({ where: { id, tenantId: ctx.local.tenantId } });
  if (!label) return apiError("Label not found", 404);

  if (!label.carrierTrackingId) {
    return NextResponse.json({ label });
  }

  try {
    const tracking = await carrier.getTrackingStatus(label.carrierTrackingId);
    const updated = await db.parcelLabel.update({
      where: { id: label.id },
      data: {
        carrierStatus: tracking.status,
        carrierStatusUpdatedAt: new Date(tracking.lastUpdatedAt),
      },
    });
    return NextResponse.json({ label: updated, description: tracking.description ?? null });
  } catch (err) {
    console.error("Carrier getTrackingStatus failed", label.id, err);
    // Best-effort: surface the last-known persisted status rather than a 500.
    return NextResponse.json({ label });
  }
}
