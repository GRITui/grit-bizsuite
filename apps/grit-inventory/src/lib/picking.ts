import type { Prisma } from "@/generated/prisma/client";
import { resolveStore } from "@/lib/stores";

type TxClient = Prisma.TransactionClient;

export class PickOrderNotFoundError extends Error {}
export class OrderNotFulfillingError extends Error {}
export class PickTaskExistsError extends Error {}
export class PickTaskNotFoundError extends Error {}
export class PickSkuNotFoundError extends Error {
  constructor(public readonly sku: string) {
    super(`No pick item matches SKU ${sku}`);
  }
}

/**
 * Pure reducer over a list of `isPrimary` `VariantLocation` rows (already
 * filtered to `isPrimary: true`, ordered oldest-first by the caller's query)
 * into a `variantId -> code` map, one entry per variant. `isPrimary` is NOT
 * DB-uniqueness-enforced (see schema note on `VariantLocation`), so a
 * variant can legally have more than one row flagged primary (e.g. a stale
 * flag left over from moving a variant between locations) — the app-level
 * convention (documented in the README) is that the first (oldest, by the
 * caller's `orderBy: createdAt asc`) isPrimary row per variant wins and any
 * later duplicates are ignored.
 */
export function resolvePrimaryLocationCodes(
  locations: { variantId: string; code: string }[]
): Map<string, string> {
  const codeByVariant = new Map<string, string>();
  for (const loc of locations) {
    if (!codeByVariant.has(loc.variantId)) codeByVariant.set(loc.variantId, loc.code);
  }
  return codeByVariant;
}

/**
 * Creates the pick task for an order already in `fulfilling` — the
 * scanner-driven "go gather these items" step (Grit WMS epic). One per
 * order (1:1, DB-unique on `PickTask.orderId`). Does NOT move stock: the
 * order's lines were already decremented at the fulfilling transition (see
 * `transitionOrder` in lib/orders.ts) — this only tracks the physical
 * gather-and-verify step.
 *
 * Snapshots each line's variant's primary `VariantLocation.code` (if any)
 * onto `PickTaskItem.locationCode` at creation time, so a later edit to the
 * planogram doesn't retroactively change what the picker was shown.
 */
export async function createPickTask(
  tx: TxClient,
  params: { tenantId: string; orderId: string; storeId?: string | null }
) {
  const order = await tx.order.findFirst({
    where: { id: params.orderId, tenantId: params.tenantId },
    include: { lines: true, pickTask: true },
  });
  if (!order) throw new PickOrderNotFoundError(params.orderId);
  if (order.status !== "fulfilling") {
    throw new OrderNotFulfillingError(`Order ${order.orderNumber} is not in fulfilling (status: ${order.status})`);
  }
  if (order.pickTask) {
    throw new PickTaskExistsError(`Order ${order.orderNumber} already has a pick task`);
  }

  // Bundle lines (variantId null) are unsupported until Milestone 2 — same
  // exclusion transitionOrder applies when decrementing stock.
  const lines = order.lines.filter((l) => l.variantId);

  const store = await resolveStore(tx, params.tenantId, params.storeId ?? order.storeId ?? null);

  const locations = lines.length
    ? await tx.variantLocation.findMany({
        where: {
          tenantId: params.tenantId,
          storeId: store.id,
          variantId: { in: lines.map((l) => l.variantId as string) },
          isPrimary: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const codeByVariant = resolvePrimaryLocationCodes(locations);

  return tx.pickTask.create({
    data: {
      tenantId: params.tenantId,
      orderId: order.id,
      storeId: store.id,
      status: "pending",
      items: {
        create: lines.map((l) => ({
          orderLineId: l.id,
          variantId: l.variantId as string,
          locationCode: codeByVariant.get(l.variantId as string) ?? null,
          quantityRequired: l.quantity,
        })),
      },
    },
    include: { items: { include: { variant: { select: { sku: true, name: true } } } } },
  });
}

/**
 * Pure quantity-clamping step of a scan: increments the current scanned
 * count by 1, capped at `required` so an extra scan of an already-fulfilled
 * line is a no-op beyond re-stamping `scannedAt` (handled by the caller).
 */
export function nextScannedQuantity(current: number, required: number): number {
  return Math.min(current + 1, required);
}

/**
 * Pure completion check: a pick task is done once every item's
 * `quantityPicked` meets its `quantityRequired`. An empty item list is
 * vacuously complete (mirrors `Array.prototype.every`).
 */
export function isPickTaskComplete(
  items: { quantityPicked: number; quantityRequired: number }[]
): boolean {
  return items.every((i) => i.quantityPicked >= i.quantityRequired);
}

/**
 * Pure timestamp-transition step: `startedAt` stamps on first touch and
 * never moves again; `completedAt` stamps the first time `allDone` flips
 * true and must NOT keep advancing on later redundant scans of an
 * already-complete task (capped quantities re-trigger `allDone`).
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
 * Records one scanned unit against the matching `PickTaskItem` (matched by
 * variant SKU). Increments `quantityPicked` by 1, capped at
 * `quantityRequired` (extra scans of an already-fulfilled line are a no-op
 * beyond re-stamping `scannedAt`). Once every item's `quantityPicked` meets
 * its `quantityRequired`, the task auto-completes.
 */
export async function scanPickItem(
  tx: TxClient,
  params: { pickTaskId: string; sku: string; tenantId: string }
) {
  const task = await tx.pickTask.findFirst({
    where: { id: params.pickTaskId, tenantId: params.tenantId },
    include: { items: { include: { variant: { select: { id: true, sku: true } } } } },
  });
  if (!task) throw new PickTaskNotFoundError(params.pickTaskId);

  const item = task.items.find((i) => i.variant.sku === params.sku);
  if (!item) throw new PickSkuNotFoundError(params.sku);

  const now = new Date();
  await tx.pickTaskItem.update({
    where: { id: item.id },
    data: {
      quantityPicked: nextScannedQuantity(item.quantityPicked, item.quantityRequired),
      scannedAt: now,
    },
  });

  const refreshedItems = await tx.pickTaskItem.findMany({ where: { pickTaskId: task.id } });
  const allDone = isPickTaskComplete(refreshedItems);
  const timestamps = resolveTaskTimestamps({
    allDone,
    now,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  });

  return tx.pickTask.update({
    where: { id: task.id },
    data: {
      status: allDone ? "complete" : "in_progress",
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
    },
    include: { items: { include: { variant: { select: { sku: true, name: true } } } } },
  });
}
