import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Naive threshold check — no third-party notification channel is wired up
 * for M1 (see handoff Section 6 open questions), so this surfaces alerts via
 * function logs and leaves them queryable through the same low-stock query
 * the admin dashboard already uses.
 */
export async function checkRestockAlerts(db: PrismaClient): Promise<{ alertCount: number }> {
  const variants = await db.variant.findMany({
    where: { isActive: true },
    include: { product: true },
  });
  const belowThreshold = variants.filter((v) => v.quantityOnHand <= v.reorderThreshold);

  for (const variant of belowThreshold) {
    console.log(
      `[restock-alert] tenant=${variant.tenantId} sku=${variant.sku} product="${variant.product.name}" onHand=${variant.quantityOnHand} threshold=${variant.reorderThreshold}`
    );
  }

  return { alertCount: belowThreshold.length };
}
