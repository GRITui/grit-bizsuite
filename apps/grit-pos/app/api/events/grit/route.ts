import "server-only";

import { NextResponse } from "next/server";
import { parseGritEvent, type PromotionUpdatedEvent } from "@grit/shared-events/contracts";
import { verifyWebhook } from "@grit/shared-events/webhook";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Inbound Grit BizSuite event webhook (HMAC-signed by @grit/shared-events).
//
// This app has no middleware/proxy.ts route-protection list to exclude this
// route from — every staff-only route instead calls requireTenantId()
// explicitly at the top of its handler (see lib/tenant.ts). This route
// deliberately does not, the same way app/api/stripe/webhook and
// app/api/pickup/** don't: authentication here IS the HMAC signature,
// verified against GRIT_EVENT_WEBHOOK_SECRET, not a staff session.
//
// Handles `promotion.updated` from grit-inventory: upserts (or deletes, when
// `deleted` or `!is_active`) the local `PromotionRule` cache row that
// lib/promotions.ts evaluates at checkout. grit-pos is offline-first and
// never calls another app live at sale time, so this webhook — syncing the
// cache ahead of time — is the only way a promotion rule ever reaches the
// register (see PromotionRule's schema.prisma doc comment).
//
// Tenancy: the envelope's `organization_id` is used directly as
// `PromotionRule.tenantId` (opaque text, matched by equality) — the same
// convention this app's outbound events use in the other direction (see
// lib/events.ts / lib/velocity.ts doc comments).
//
// Idempotency: no separate dedupe-by-`event_id` table. Both branches below
// (upsert keyed on `id = promotion_id`, delete-if-exists) are naturally
// idempotent — a redelivered/replayed event just re-applies the same end
// state, so there's nothing a dedupe marker would additionally protect here.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const secret = process.env.GRIT_EVENT_WEBHOOK_SECRET;
  if (!secret) {
    // Feature inert without configuration — never crash.
    return NextResponse.json({ error: "Event webhook not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const verified = await verifyWebhook({
    secret,
    rawBody,
    signatureHeader: request.headers.get("x-grit-signature"),
    timestampHeader: request.headers.get("x-grit-timestamp"),
  });
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseGritEvent(json);
  if (!event) {
    return NextResponse.json({ error: "Invalid event envelope" }, { status: 400 });
  }

  if (event.event !== "promotion.updated") {
    // Not (yet) a consumer of this event type — acknowledge so the publisher
    // doesn't treat it as a delivery failure and keep retrying.
    return NextResponse.json({ ok: true, ignored: event.event });
  }

  try {
    const result = await handlePromotionUpdated(event as PromotionUpdatedEvent);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to process promotion.updated", event.event_id, err);
    return NextResponse.json({ error: "Internal error handling webhook" }, { status: 500 });
  }
}

async function handlePromotionUpdated(event: PromotionUpdatedEvent) {
  const { organization_id, data } = event;

  if (data.deleted || !data.is_active) {
    // No-op if the row doesn't exist (already removed by an earlier
    // delivery, or was never synced in the first place).
    await prisma.promotionRule.deleteMany({ where: { id: data.promotion_id } });
    return { ok: true, action: "removed" as const, promotion_id: data.promotion_id };
  }

  const shared = {
    tenantId: organization_id,
    name: data.name,
    type: data.type,
    isActive: data.is_active,
    startsAt: data.starts_at ? new Date(data.starts_at) : null,
    endsAt: data.ends_at ? new Date(data.ends_at) : null,
    buyQuantity: data.buy_quantity ?? null,
    payQuantity: data.pay_quantity ?? null,
    minQuantity: data.min_quantity ?? null,
    discountKind: data.discount_kind ?? null,
    discountValue: data.discount_value ?? null,
    bundlePrice: data.bundle_price ?? null,
    items: data.items as unknown as object,
  };

  await prisma.promotionRule.upsert({
    where: { id: data.promotion_id },
    create: { id: data.promotion_id, ...shared },
    update: shared,
  });
  return { ok: true, action: "synced" as const, promotion_id: data.promotion_id };
}
