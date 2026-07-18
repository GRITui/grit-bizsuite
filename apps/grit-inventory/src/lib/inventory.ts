import type { Prisma, StockMovementReason } from "@/generated/prisma/client";

/** Prisma transaction client — accepts either `db` or a `$transaction` callback's `tx`. */
type TxClient = Prisma.TransactionClient;

export class InsufficientStockError extends Error {
  constructor(public readonly variantId: string) {
    super(`Insufficient stock for variant ${variantId}`);
  }
}

/**
 * Row-locks the variant (SELECT ... FOR UPDATE) so concurrent order entry and
 * stock adjustments serialize instead of racing on the same row.
 */
async function lockVariantForUpdate(tx: TxClient, tenantId: string, variantId: string) {
  const rows = await tx.$queryRaw<{ id: string; quantityOnHand: number }[]>`
    SELECT "id", "quantityOnHand" FROM "Variant"
    WHERE "id" = ${variantId} AND "tenantId" = ${tenantId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Applies a signed quantity change to a variant and writes the paired audit
 * `StockMovement` row atomically. Must be called inside `db.$transaction`.
 * Throws `InsufficientStockError` if the resulting quantity would go negative.
 */
export async function applyStockMovement(
  tx: TxClient,
  params: {
    tenantId: string;
    storeId?: string | null;
    variantId: string;
    delta: number;
    reason: StockMovementReason;
    orderLineId?: string;
    bundleId?: string;
    note?: string;
    createdById?: string;
  }
): Promise<number> {
  const locked = await lockVariantForUpdate(tx, params.tenantId, params.variantId);
  if (!locked) {
    throw new Error(`Variant ${params.variantId} not found for tenant ${params.tenantId}`);
  }

  const newQuantity = locked.quantityOnHand + params.delta;
  if (newQuantity < 0) {
    throw new InsufficientStockError(params.variantId);
  }

  await tx.variant.update({
    where: { id: params.variantId },
    data: { quantityOnHand: newQuantity },
  });

  await tx.stockMovement.create({
    data: {
      tenantId: params.tenantId,
      storeId: params.storeId ?? null,
      variantId: params.variantId,
      delta: params.delta,
      reason: params.reason,
      orderLineId: params.orderLineId,
      bundleId: params.bundleId,
      note: params.note,
      createdById: params.createdById,
    },
  });

  return newQuantity;
}
