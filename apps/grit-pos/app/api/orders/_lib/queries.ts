import "server-only";

import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type {
  OrderChannel,
  OrderStatus,
  PaymentStatus,
  TenderType,
} from "@/app/generated/prisma/enums";
import { eventItemSku } from "@/lib/events";
import { evaluatePromotions, type PromotionCartLine } from "@/lib/promotions";
import { sumDecimals } from "./pricing";

// ---------------------------------------------------------------------------
// Shared "fetch an order the way the staff POS needs it" query + DTO shaping,
// used by every route under app/api/orders/**. Keeping the `include` and the
// serialization in one place means the cart UI always sees the same shape
// whether it just created a line, tendered a payment, or re-fetched the
// order fresh.
// ---------------------------------------------------------------------------

export const orderInclude = {
  table: { select: { id: true, label: true } },
  lines: {
    orderBy: { id: "asc" },
    include: {
      product: { select: { id: true, name: true } },
      // sku feeds transaction.completed event items (lib/events.ts).
      variant: { select: { id: true, name: true, sku: true } },
      addOns: {
        include: { addOn: { select: { id: true, name: true } } },
      },
    },
  },
  payments: { orderBy: { createdAt: "asc" } },
} as const satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

export async function findOrderForTenant(tenantId: string, orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: orderInclude,
  });
}

export async function listOrdersForTenant(tenantId: string, statuses: OrderStatus[]) {
  return prisma.order.findMany({
    where: { tenantId, status: { in: statuses } },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
}

// -- DTO shaping ---------------------------------------------------------

export interface OrderLineAddOnDTO {
  id: string;
  addOnId: string;
  name: string;
  price: number;
}

export interface OrderLineDTO {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  addOns: OrderLineAddOnDTO[];
}

export interface PaymentDTO {
  id: string;
  tenderType: TenderType;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
}

export interface DiscountAppliedDTO {
  ruleId: string;
  name: string;
  amount: number;
}

export interface OrderDTO {
  id: string;
  tenantId: string;
  channel: OrderChannel;
  status: OrderStatus;
  tableId: string | null;
  tableLabel: string | null;
  createdAt: string;
  updatedAt: string;
  lines: OrderLineDTO[];
  payments: PaymentDTO[];
  /** Sum of every line's lineTotal. Line pricing itself is never discounted in place (see OrderLine.unitPrice doc comment) — promotions are applied below as a distinct order-total adjustment. */
  subtotal: number;
  /** Total of every active PromotionRule that matched the order's current lines (lib/promotions.ts), recomputed on every read (not persisted) — same "derived, not stored" treatment as `subtotal`/`paidTotal`. */
  discountTotal: number;
  /** Per-rule breakdown backing `discountTotal`, for display (e.g. "Promotions" row) and audit. */
  discountsApplied: DiscountAppliedDTO[];
  /** Sum of every `succeeded` payment's amount. */
  paidTotal: number;
  /** max(subtotal - discountTotal - paidTotal, 0) — what's still owed. */
  balanceDue: number;
}

/**
 * Fetches the tenant's currently-active PromotionRule cache rows (synced by
 * app/api/events/grit/route.ts) and evaluates them against this order's
 * lines. SKUs are resolved the same way the outbound `transaction.completed`
 * event resolves them (lib/events.ts `eventItemSku`) so promotion scoping and
 * event reporting always agree on what a line's SKU is.
 */
export async function computeOrderDiscount(
  tenantId: string,
  lines: OrderWithRelations["lines"],
): Promise<{ totalDiscount: Decimal; applied: DiscountAppliedDTO[] }> {
  if (lines.length === 0) return { totalDiscount: new Decimal(0), applied: [] };

  const rules = await prisma.promotionRule.findMany({ where: { tenantId, isActive: true } });
  if (rules.length === 0) return { totalDiscount: new Decimal(0), applied: [] };

  const cartLines: PromotionCartLine[] = lines.map((line) => ({
    sku: eventItemSku({ productId: line.productId, variantSku: line.variant?.sku ?? null }),
    quantity: line.quantity,
    unitPrice: Number(line.unitPrice),
  }));

  const { totalDiscount, applied } = evaluatePromotions(cartLines, rules);
  return { totalDiscount: new Decimal(totalDiscount), applied };
}

export async function serializeOrder(order: OrderWithRelations): Promise<OrderDTO> {
  const lineTotals = order.lines.map((l) => l.lineTotal);
  const subtotal = sumDecimals(lineTotals);
  const paidTotal = sumDecimals(
    order.payments.filter((p) => p.status === "succeeded").map((p) => p.amount),
  );
  const { totalDiscount, applied } = await computeOrderDiscount(order.tenantId, order.lines);
  const balanceDue = clampNonNegative(subtotal.minus(totalDiscount).minus(paidTotal));

  return {
    id: order.id,
    tenantId: order.tenantId,
    channel: order.channel,
    status: order.status,
    tableId: order.tableId,
    tableLabel: order.table?.label ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    lines: order.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: line.product.name,
      variantId: line.variantId,
      variantName: line.variant?.name ?? null,
      quantity: line.quantity,
      unitPrice: Number(line.unitPrice),
      lineTotal: Number(line.lineTotal),
      addOns: line.addOns.map((a) => ({
        id: a.id,
        addOnId: a.addOnId,
        name: a.addOn.name,
        price: Number(a.price),
      })),
    })),
    payments: order.payments.map((p) => ({
      id: p.id,
      tenderType: p.tenderType,
      amount: Number(p.amount),
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
    subtotal: Number(subtotal),
    discountTotal: Number(totalDiscount),
    discountsApplied: applied,
    paidTotal: Number(paidTotal),
    balanceDue: Number(balanceDue),
  };
}

function clampNonNegative(value: Decimal): Decimal {
  return value.isNegative() ? new Decimal(0) : value;
}
