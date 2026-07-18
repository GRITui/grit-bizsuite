import { NextRequest, NextResponse } from "next/server";
import { assertFeature } from "@grit/passport";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { csvResponse } from "@/lib/csv";
import { daysAgo } from "@/lib/format";
import { entitlementResponse, requireGritContext } from "@/lib/passport";

/**
 * GET /api/reports/cogs?from&to[&format=csv] — FIFO cost of goods sold per
 * variant, computed from the drained-lot audit records
 * (`StockLotConsumption`). Requires `inventory.fifo_costing` (SCALE).
 *
 * Rows with `lotId = null` are fallback-costed consumption (no open lot at
 * drain time) and are included, reported via `fallback_units`.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireGritContext();
  try {
    assertFeature(ctx.grit, "inventory.fifo_costing");
  } catch (err) {
    const res = entitlementResponse(err);
    if (res) return res;
    throw err;
  }

  const { searchParams } = request.nextUrl;
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : daysAgo(30);
  const to = toParam ? new Date(toParam) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return apiError("Invalid from/to date");
  }

  const consumptions = await db.stockLotConsumption.findMany({
    where: {
      tenantId: ctx.local.tenantId,
      createdAt: { gte: from, lte: to },
    },
    include: {
      movement: { select: { reason: true } },
    },
  });

  const variantIds = [...new Set(consumptions.map((c) => c.variantId))];
  const variants = await db.variant.findMany({
    where: { id: { in: variantIds } },
    include: { product: { select: { name: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const byVariant = new Map<
    string,
    { units: number; cost: number; fallbackUnits: number }
  >();
  for (const c of consumptions) {
    // Transfers move cost between stores; they are not cost of goods SOLD.
    if (c.movement.reason === "transfer_out") continue;
    const agg = byVariant.get(c.variantId) ?? { units: 0, cost: 0, fallbackUnits: 0 };
    agg.units += c.quantity;
    agg.cost += c.quantity * Number(c.unitCost);
    if (c.lotId === null) agg.fallbackUnits += c.quantity;
    byVariant.set(c.variantId, agg);
  }

  const rows = [...byVariant.entries()]
    .map(([variantId, agg]) => {
      const variant = variantById.get(variantId);
      return {
        sku: variant?.sku ?? variantId,
        product: variant?.product.name ?? "(deleted)",
        variant: variant?.name ?? "(deleted)",
        units_consumed: agg.units,
        fifo_cogs: Number(agg.cost.toFixed(2)),
        avg_unit_cost: agg.units > 0 ? Number((agg.cost / agg.units).toFixed(4)) : 0,
        fallback_units: agg.fallbackUnits,
      };
    })
    .sort((a, b) => b.fifo_cogs - a.fifo_cogs);

  if (searchParams.get("format") === "csv") {
    return csvResponse(rows, `fifo-cogs-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv`);
  }

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    total_cogs: Number(rows.reduce((sum, r) => sum + r.fifo_cogs, 0).toFixed(2)),
    rows,
  });
}
