import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, requireApiSession } from "@/lib/api";

const resolveSchema = z.object({
  resolvedNote: z.string().max(2000).optional(),
});

/** PATCH /api/unmatched-sales/[id] — mark a SKU-alignment visibility-stopgap
 * row (BACKLOG.md, POS<->Inventory SKU alignment, approach 3) resolved once
 * a human has reconciled the underlying stock discrepancy by hand. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  const { id } = await params;

  const row = await db.unmatchedSaleItem.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!row) return apiError("Unmatched sale item not found", 404);
  if (row.resolvedAt) return apiError("Already resolved", 409);

  const body = await request.json().catch(() => null);
  const parsed = resolveSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid update");
  }

  const updated = await db.unmatchedSaleItem.update({
    where: { id },
    data: { resolvedAt: new Date(), resolvedNote: parsed.data.resolvedNote ?? null },
  });

  return NextResponse.json({ item: updated });
}
