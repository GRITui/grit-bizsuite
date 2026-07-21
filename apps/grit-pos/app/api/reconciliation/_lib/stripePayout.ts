import "server-only";

import { getStripe } from "@/lib/stripe";
import { businessDayRange } from "./dates";

// ---------------------------------------------------------------------------
// Stripe payout cross-check.
//
// `stripeTotal` on DailyReconciliation is derived from our own `Payment`
// rows (tenderType: "stripe", status: "succeeded") — i.e. what our database
// *thinks* was collected via Stripe that business day. This cross-checks
// that figure against what Stripe itself reports for actually-succeeded,
// non-refunded charges, since our webhook could in principle miss/duplicate
// an event, or a charge could later be disputed/refunded outside our record.
//
// Scoping caveat: every tenant shares one platform `STRIPE_SECRET_KEY` (see
// lib/stripe.ts) — there's no per-tenant Stripe Connect account. Charges are
// scoped to a tenant via `Charge.metadata.tenantId`, which the pickup
// checkout route (app/api/pickup/[tenantSlug]/checkout/route.ts) now sets
// via `payment_intent_data.metadata` when creating the Checkout Session.
// Charges made BEFORE that fix shipped have no such metadata and are
// invisible to this cross-check — this only becomes fully trustworthy going
// forward from here.
// ---------------------------------------------------------------------------

export type StripePayoutCheck =
  | { available: true; total: number; note: string }
  | { available: false; total: null; note: string };

/**
 * Sums Stripe's own record of succeeded, non-refunded charges for this
 * tenant's business day, using the Charges API (not Balance Transactions —
 * charges carry `metadata` directly, balance transactions don't) filtered by
 * `created` (unix seconds) and `metadata.tenantId` client-side, since Stripe
 * doesn't support server-side metadata filtering on `charges.list`.
 */
export async function getStripePayoutTotal(
  tenantId: string,
  businessDate: Date,
): Promise<StripePayoutCheck> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      available: false,
      total: null,
      note:
        "Stripe payout cross-check is not configured in this environment (STRIPE_SECRET_KEY unset) " +
        "— the stripeTotal above is our own Payment-table figure, not independently verified against Stripe.",
    };
  }

  const { start, end } = businessDayRange(businessDate);

  try {
    const stripe = getStripe();
    let netMinorUnits = 0;
    let matched = 0;

    for await (const charge of stripe.charges.list({
      created: { gte: Math.floor(start.getTime() / 1000), lt: Math.floor(end.getTime() / 1000) },
      limit: 100,
    })) {
      if (charge.status !== "succeeded") continue;
      if (charge.metadata?.tenantId !== tenantId) continue;
      matched += 1;
      netMinorUnits += charge.amount - charge.amount_refunded;
    }

    return {
      available: true,
      total: netMinorUnits / 100,
      note:
        matched > 0
          ? `Verified against ${matched} succeeded Stripe charge(s) for this tenant/day (net of refunds).`
          : "No succeeded Stripe charges found for this tenant/day — pre-metadata-fix charges won't match here even if they exist in Payment records.",
    };
  } catch (err) {
    return {
      available: false,
      total: null,
      note: `Stripe API call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
