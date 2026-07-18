import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const { tenantId } = session;

  const [productCount, activeVariants, pendingOrders, activeDeliveries, recentOrders] = await Promise.all([
    db.product.count({ where: { tenantId, isActive: true } }),
    db.variant.findMany({
      where: { tenantId, isActive: true },
      include: { product: true },
      orderBy: { quantityOnHand: "asc" },
    }),
    db.order.count({ where: { tenantId, status: { in: ["pending", "paid", "fulfilling"] } } }),
    db.delivery.count({ where: { tenantId, status: { in: ["assigned", "out_for_delivery"] } } }),
    db.order.findMany({
      where: { tenantId },
      take: 6,
      orderBy: { createdAt: "desc" },
      include: { lines: true },
    }),
  ]);

  const lowStockVariants = activeVariants
    .filter((variant) => variant.quantityOnHand <= variant.reorderThreshold)
    .slice(0, 5);

  const stats = [
    { label: "Active products", value: productCount },
    { label: "Open orders", value: pendingOrders },
    { label: "Deliveries in flight", value: activeDeliveries },
    { label: "Low-stock variants", value: lowStockVariants.length },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" description={`Welcome back, ${session.name}.`} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{stat.value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent orders</h2>
          <div className="mt-3 space-y-2">
            {recentOrders.length === 0 && <p className="text-sm text-zinc-500">No orders yet.</p>}
            {recentOrders.map((order) => (
              <Link
                key={order.id}
                href={`/admin/orders/${order.id}`}
                className="flex items-center justify-between rounded-md border border-zinc-100 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">#{order.orderNumber}</p>
                  <p className="text-xs text-zinc-500">{formatDate(order.createdAt)}</p>
                </div>
                <StatusBadge status={order.status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Low stock</h2>
          <div className="mt-3 space-y-2">
            {lowStockVariants.length === 0 && <p className="text-sm text-zinc-500">Nothing below threshold.</p>}
            {lowStockVariants.map((variant) => (
              <div
                key={variant.id}
                className="flex items-center justify-between rounded-md border border-zinc-100 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {variant.product.name} — {variant.name}
                  </p>
                  <p className="text-xs text-zinc-500">SKU {variant.sku}</p>
                </div>
                <p className="font-mono text-sm text-red-600">
                  {variant.quantityOnHand} / {variant.reorderThreshold}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
