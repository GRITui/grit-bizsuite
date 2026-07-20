import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireTenantId } from "@/lib/tenant";
import NewPeriodForm from "./NewPeriodForm";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function PayrollPage() {
  const tenantId = await requireTenantId();

  const periods = await prisma.payrollPeriod.findMany({
    where: { tenantId },
    include: { _count: { select: { records: true } } },
    orderBy: { startDate: "desc" },
  });

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
      </div>

      <NewPeriodForm />

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 font-medium">Period</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Records</th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No payroll periods yet.
                </td>
              </tr>
            )}
            {periods.map((period) => (
              <tr key={period.id} className="border-b border-zinc-200 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">
                  <Link href={`/payroll/${period.id}`} className="font-medium underline">
                    {formatDate(period.startDate)} – {formatDate(period.endDate)}
                  </Link>
                </td>
                <td className="px-4 py-2 capitalize">{period.status}</td>
                <td className="px-4 py-2">{period._count.records}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
