import { requireTenantId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@/app/generated/prisma/enums";
import { listOrdersForTenant, serializeOrder } from "@/app/api/orders/_lib/queries";
import OrderDashboard from "@/components/pos/OrderDashboard";

export default async function PosDashboardPage() {
  // layout.tsx already redirects unauthenticated staff to /login.
  const tenantId = await requireTenantId();

  const [orders, tables] = await Promise.all([
    listOrdersForTenant(tenantId, [OrderStatus.open, OrderStatus.tendered]),
    prisma.table.findMany({
      where: { tenantId },
      select: { id: true, label: true },
      orderBy: { label: "asc" },
    }),
  ]);

  return (
    <OrderDashboard initialOrders={orders.map(serializeOrder)} tables={tables} />
  );
}
