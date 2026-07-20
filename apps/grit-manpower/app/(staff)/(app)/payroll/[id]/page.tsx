import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantId } from "@/lib/tenant";
import GenerateButton from "./GenerateButton";
import FinalizeButton from "./FinalizeButton";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function PayrollPeriodPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenantId = await requireTenantId();
  const { id } = await params;

  const period = await prisma.payrollPeriod.findFirst({
    where: { id, tenantId },
    include: {
      records: {
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [
          { employee: { lastName: "asc" } },
          { employee: { firstName: "asc" } },
        ],
      },
    },
  });

  if (!period) {
    notFound();
  }

  const isFinalized = period.status === "finalized";
  const hasRecords = period.records.length > 0;

  const totals = period.records.reduce(
    (acc, record) => ({
      regularHours: acc.regularHours + Number(record.regularHours),
      overtimeHours: acc.overtimeHours + Number(record.overtimeHours),
      grossPay: acc.grossPay + Number(record.grossPay),
    }),
    { regularHours: 0, overtimeHours: 0, grossPay: 0 },
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {formatDate(period.startDate)} – {formatDate(period.endDate)}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 capitalize">
            Status: {period.status}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!isFinalized && <GenerateButton periodId={period.id} />}
          {!isFinalized && hasRecords && <FinalizeButton periodId={period.id} />}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-4 py-2 font-medium">Regular hours</th>
              <th className="px-4 py-2 font-medium">OT hours</th>
              <th className="px-4 py-2 font-medium">Rate</th>
              <th className="px-4 py-2 font-medium">Gross pay</th>
            </tr>
          </thead>
          <tbody>
            {!hasRecords && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No payroll records yet. Generate this period to compute pay from clocked hours.
                </td>
              </tr>
            )}
            {period.records.map((record) => (
              <tr key={record.id} className="border-b border-zinc-200 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">
                  {record.employee.firstName} {record.employee.lastName}
                </td>
                <td className="px-4 py-2">{Number(record.regularHours).toFixed(2)}</td>
                <td className="px-4 py-2">{Number(record.overtimeHours).toFixed(2)}</td>
                <td className="px-4 py-2">${Number(record.hourlyRate).toFixed(2)}</td>
                <td className="px-4 py-2">${Number(record.grossPay).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          {hasRecords && (
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 font-medium dark:border-zinc-800 dark:bg-zinc-900">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2">{totals.regularHours.toFixed(2)}</td>
                <td className="px-4 py-2">{totals.overtimeHours.toFixed(2)}</td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2">${totals.grossPay.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
