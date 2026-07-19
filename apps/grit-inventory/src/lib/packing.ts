import type { Prisma } from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

export class PackOrderNotFoundError extends Error {}
export class PickTaskNotCompleteError extends Error {}
export class PackTaskExistsError extends Error {}
export class PackTaskNotFoundError extends Error {}
export class PackSkuNotFoundError extends Error {
  constructor(public readonly sku: string) {
    super(`No pack item matches SKU ${sku}`);
  }
}

/**
 * Creates the pack task for an order — a second scan pass that re-verifies
 * contents before sealing/labeling — sourced from the order's already
 * `complete` PickTask (its items, 1:1 by orderLineId/variantId with the same
 * `quantityRequired`). One per order (1:1, DB-unique on `PackTask.orderId`).
 * Mirrors `createPickTask`; does not move stock.
 */
export async function createPackTask(tx: TxClient, params: { tenantId: string; orderId: string }) {
  const order = await tx.order.findFirst({
    where: { id: params.orderId, tenantId: params.tenantId },
    include: {
      packTask: true,
      pickTask: { include: { items: true } },
    },
  });
  if (!order) throw new PackOrderNotFoundError(params.orderId);
  if (order.packTask) {
    throw new PackTaskExistsError(`Order ${order.orderNumber} already has a pack task`);
  }
  if (!order.pickTask || order.pickTask.status !== "complete") {
    throw new PickTaskNotCompleteError(`Order ${order.orderNumber}'s pick task is not complete yet`);
  }

  return tx.packTask.create({
    data: {
      tenantId: params.tenantId,
      orderId: order.id,
      status: "pending",
      items: {
        create: order.pickTask.items.map((i) => ({
          orderLineId: i.orderLineId,
          variantId: i.variantId,
          quantityRequired: i.quantityRequired,
        })),
      },
    },
    include: { items: { include: { variant: { select: { sku: true, name: true } } } } },
  });
}

/**
 * Pure quantity-clamping step of a scan: increments the current scanned
 * count by 1, capped at `required`. Mirrors `nextScannedQuantity` in
 * lib/picking.ts.
 */
export function nextScannedQuantity(current: number, required: number): number {
  return Math.min(current + 1, required);
}

/**
 * Pure completion check: a pack task is done once every item's
 * `quantityPacked` meets its `quantityRequired`. Mirrors
 * `isPickTaskComplete` in lib/picking.ts.
 */
export function isPackTaskComplete(
  items: { quantityPacked: number; quantityRequired: number }[]
): boolean {
  return items.every((i) => i.quantityPacked >= i.quantityRequired);
}

/**
 * Pure timestamp-transition step, identical semantics to
 * `resolveTaskTimestamps` in lib/picking.ts: `startedAt` stamps once and
 * never moves, `completedAt` stamps the first time `allDone` flips true and
 * must not keep advancing on later redundant scans.
 */
export function resolveTaskTimestamps(params: {
  allDone: boolean;
  now: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}): { startedAt: Date; completedAt: Date | null } {
  return {
    startedAt: params.startedAt ?? params.now,
    completedAt: params.allDone ? (params.completedAt ?? params.now) : params.completedAt,
  };
}

/**
 * Records one scanned unit against the matching `PackTaskItem` (matched by
 * variant SKU). Mirrors `scanPickItem` exactly, one layer down
 * (`quantityPacked` instead of `quantityPicked`).
 */
export async function scanPackItem(
  tx: TxClient,
  params: { packTaskId: string; sku: string; tenantId: string }
) {
  const task = await tx.packTask.findFirst({
    where: { id: params.packTaskId, tenantId: params.tenantId },
    include: { items: { include: { variant: { select: { id: true, sku: true } } } } },
  });
  if (!task) throw new PackTaskNotFoundError(params.packTaskId);

  const item = task.items.find((i) => i.variant.sku === params.sku);
  if (!item) throw new PackSkuNotFoundError(params.sku);

  const now = new Date();
  await tx.packTaskItem.update({
    where: { id: item.id },
    data: {
      quantityPacked: nextScannedQuantity(item.quantityPacked, item.quantityRequired),
      scannedAt: now,
    },
  });

  const refreshedItems = await tx.packTaskItem.findMany({ where: { packTaskId: task.id } });
  const allDone = isPackTaskComplete(refreshedItems);
  const timestamps = resolveTaskTimestamps({
    allDone,
    now,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  });

  return tx.packTask.update({
    where: { id: task.id },
    data: {
      status: allDone ? "complete" : "in_progress",
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
    },
    include: { items: { include: { variant: { select: { sku: true, name: true } } } } },
  });
}
