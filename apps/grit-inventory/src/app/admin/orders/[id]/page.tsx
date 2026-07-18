import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/format";
import { OrderActions } from "@/components/order-actions";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const order = await db.order.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      lines: { include: { variant: true } },
      payments: { orderBy: { createdAt: "desc" } },
      delivery: true,
      createdBy: { select: { name: true } },
    },
  });
  if (!order) notFound();

  const total = order.lines.reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0);

  return (
    <div>
      <PageHeader
        title={`Order #${order.orderNumber}`}
        description={`Created ${formatDate(order.createdAt)}${order.createdBy ? ` by ${order.createdBy.name}` : ""}`}
        action={<StatusBadge status={order.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-0">
            <div className="p-4">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Line items</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">{line.description}</td>
                    <td className="px-4 py-2 text-zinc-500">x{line.quantity}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {formatCurrency(Number(line.unitPrice) * line.quantity)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-200 font-medium dark:border-zinc-700">
                  <td className="px-4 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(total)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Payments</h2>
            {order.payments.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No payments recorded.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex justify-between text-zinc-600 dark:text-zinc-400">
                    <span>
                      {p.method.replace(/_/g, " ")} — {formatDate(p.createdAt)}
                    </span>
                    <span className="font-mono">{formatCurrency(p.amount.toString())}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>
            <div className="mt-3">
              <OrderActions orderId={order.id} status={order.status} total={total} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Customer</h2>
            <dl className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <div>{order.customerName ?? "—"}</div>
              <div>{order.customerPhone ?? "—"}</div>
              <div>{order.customerAddress ?? "—"}</div>
            </dl>
            {order.notes && <p className="mt-3 text-sm text-zinc-500">{order.notes}</p>}
          </Card>

          {order.delivery && (
            <Card>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Delivery</h2>
              <div className="mt-2 flex items-center justify-between">
                <StatusBadge status={order.delivery.status} />
                <Link
                  href={`/admin/deliveries/${order.delivery.id}`}
                  className="text-sm font-medium text-zinc-700 hover:underline dark:text-zinc-300"
                >
                  View
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
