import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { ResolveUnmatchedSaleButton } from "@/components/unmatched-sales-manager";

export const dynamic = "force-dynamic";

/**
 * SKU-alignment visibility stopgap (BACKLOG.md, POS<->Inventory SKU
 * alignment, approach 3 — NOT a catalog-sync mechanism, and `sku` stays
 * optional/unenforced). grit-pos `transaction.completed` events whose line
 * items reference a SKU this tenant has no `Variant` for used to only push
 * an ephemeral string into an HTTP response body nobody reads
 * (`src/app/api/events/grit/route.ts`). Those misses are now persisted as
 * `UnmatchedSaleItem` rows; this page is the manual-reconciliation queue —
 * mark a row resolved once the discrepancy has been dealt with by hand.
 */
export default async function UnmatchedSalesPage() {
  const session = await requireSession();
  const items = await db.unmatchedSaleItem.findMany({
    where: { tenantId: session.tenantId, resolvedAt: null },
    orderBy: { occurredAt: "desc" },
  });

  return (
    <div>
      <PageHeader
        title="Unmatched sale items"
        description="POS sales whose SKU didn't match any inventory variant — stock was not decremented. Reconcile by hand, then mark resolved."
      />

      {items.length === 0 ? (
        <EmptyState message="No unmatched sale items — every recent POS sale matched a known SKU." />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Quantity</th>
                  <th className="px-4 py-3 font-medium">POS transaction</th>
                  <th className="px-4 py-3 font-medium">Occurred</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{item.sku}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{item.quantity}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{item.orderReference ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-500">{formatDate(item.occurredAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <ResolveUnmatchedSaleButton id={item.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
