import { notFound } from "next/navigation";
import { requireTenantId } from "@/lib/tenant";
import { findOrderForTenant, serializeOrder } from "@/app/api/orders/_lib/queries";
import { getCatalogForTenant, serializeCatalog } from "@/app/api/catalog/_lib/catalog";
import OrderBuilder from "@/components/pos/OrderBuilder";

export default async function PosOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  // layout.tsx already redirects unauthenticated staff to /login.
  const tenantId = await requireTenantId();
  const { orderId } = await params;

  const [order, categories] = await Promise.all([
    findOrderForTenant(tenantId, orderId),
    getCatalogForTenant(tenantId),
  ]);

  if (!order) {
    notFound();
  }

  return (
    <OrderBuilder initialOrder={serializeOrder(order)} catalog={serializeCatalog(categories)} />
  );
}
