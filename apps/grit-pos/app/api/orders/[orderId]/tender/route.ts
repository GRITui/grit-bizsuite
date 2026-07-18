import { NextResponse } from "next/server";
import { after } from "next/server";
import { Decimal } from "@prisma/client/runtime/client";
import { publishTransactionCompleted } from "@/lib/events";
import { checkVelocitySurge } from "@/lib/velocity";
import { requireTenantId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { OrderStatus, PaymentStatus, TenderType } from "@/app/generated/prisma/enums";
import { errorResponse, HttpError, readJsonBody } from "../../_lib/http";
import { findOrderForTenant, serializeOrder } from "../../_lib/queries";
import { parseMoneyInput, sumDecimals } from "../../_lib/pricing";

// Stripe is a valid TenderType in the schema (for future online/QR-link
// checkout flows) but isn't a real option at a staff-operated register.
const STAFF_TENDER_TYPES: TenderType[] = [TenderType.cash, TenderType.card, TenderType.qr_pay];

interface TenderBody {
  tenderType?: string;
  amount?: number | string;
}

/**
 * POST /api/orders/[orderId]/tender — records a Payment against the order.
 * Supports split tender: an order stays `tendered` until cumulative
 * successful payments cover the subtotal, at which point it flips to
 * `closed`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const tenantId = await requireTenantId();
    const { orderId } = await params;
    const body = await readJsonBody<TenderBody>(request);

    if (
      !body.tenderType ||
      !STAFF_TENDER_TYPES.includes(body.tenderType as TenderType)
    ) {
      throw new HttpError(
        400,
        `tenderType must be one of: ${STAFF_TENDER_TYPES.join(", ")}`,
      );
    }
    const tenderType = body.tenderType as TenderType;

    let amount;
    try {
      amount = parseMoneyInput(body.amount);
    } catch {
      throw new HttpError(400, "amount must be a positive number");
    }
    if (!amount.isPositive()) {
      throw new HttpError(400, "amount must be greater than zero");
    }

    const order = await findOrderForTenant(tenantId, orderId);
    if (!order) {
      throw new HttpError(404, "Order not found");
    }
    if (order.status !== OrderStatus.open && order.status !== OrderStatus.tendered) {
      throw new HttpError(409, `Cannot tender an order with status "${order.status}"`);
    }
    if (order.lines.length === 0) {
      throw new HttpError(400, "Cannot tender an empty order");
    }

    const subtotal = sumDecimals(order.lines.map((l) => l.lineTotal));
    const priorPaid = sumDecimals(
      order.payments.filter((p) => p.status === PaymentStatus.succeeded).map((p) => p.amount),
    );
    const totalPaid = priorPaid.plus(amount);
    const isFullyPaid = totalPaid.greaterThanOrEqualTo(subtotal);
    const changeDue = isFullyPaid ? totalPaid.minus(subtotal) : new Decimal(0);

    await prisma.$transaction([
      prisma.payment.create({
        data: {
          orderId,
          tenderType,
          amount,
          status: PaymentStatus.succeeded,
        },
      }),
      // Note: `channel` is deliberately left untouched here. Staff can
      // tender any in-progress order regardless of how it originated (a QR
      // dine-in order or an abandoned pickup_link order can both be
      // collected at the register), and forcing channel to "dine_in" on
      // every tender would silently destroy that provenance — which is the
      // only source of truth for channel-based reporting, since QR orders
      // have no other checkout path that could have preserved it.
      prisma.order.update({
        where: { id: orderId },
        data: {
          status: isFullyPaid ? OrderStatus.closed : OrderStatus.tendered,
        },
      }),
    ]);

    const updated = await findOrderForTenant(tenantId, orderId);
    if (!updated) throw new HttpError(500, "Failed to reload order after tendering");

    // Grit BizSuite events — published fire-and-forget AFTER the response
    // (the tender DB transaction above has committed); event plumbing can
    // never block or fail checkout.
    if (isFullyPaid) {
      after(async () => {
        await publishTransactionCompleted({
          tenantId,
          orderId,
          totalAmount: Number(subtotal),
          lines: updated.lines.map((line) => ({
            productId: line.productId,
            variantSku: line.variant?.sku ?? null,
            quantity: line.quantity,
            unitPrice: Number(line.unitPrice),
          })),
        });
        await checkVelocitySurge(tenantId);
      });
    }

    return NextResponse.json({
      order: serializeOrder(updated),
      changeDue: Number(changeDue),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
