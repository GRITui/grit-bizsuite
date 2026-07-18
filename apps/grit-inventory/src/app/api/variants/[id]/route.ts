import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, requireApiSession } from "@/lib/api";
import { applyStockMovement, InsufficientStockError } from "@/lib/inventory";
import { hasRole } from "@/lib/auth";

const updateVariantSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().nonnegative().optional(),
  reorderThreshold: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  stockAdjustment: z
    .object({
      delta: z.number().int().refine((n) => n !== 0, "Adjustment cannot be zero"),
      note: z.string().optional(),
    })
    .optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  const { id } = await params;

  const existing = await db.variant.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!existing) return apiError("Variant not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateVariantSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid update");
  }
  const { stockAdjustment, ...fields } = parsed.data;

  try {
    const variant = await db.$transaction(async (tx) => {
      if (Object.keys(fields).length > 0) {
        await tx.variant.update({ where: { id }, data: fields });
      }
      if (stockAdjustment) {
        await applyStockMovement(tx, {
          tenantId: session.tenantId,
          storeId: session.storeId,
          variantId: id,
          delta: stockAdjustment.delta,
          reason: "manual_adjustment",
          note: stockAdjustment.note,
          createdById: session.sub,
        });
      }
      return tx.variant.findUniqueOrThrow({ where: { id } });
    });

    return NextResponse.json({ variant });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return apiError("Adjustment would make stock negative", 409);
    }
    throw err;
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (!hasRole(session.role, "ADMIN")) return apiError("Forbidden", 403);
  const { id } = await params;

  const existing = await db.variant.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!existing) return apiError("Variant not found", 404);

  await db.variant.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
