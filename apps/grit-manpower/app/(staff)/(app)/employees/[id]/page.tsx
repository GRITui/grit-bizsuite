import { notFound } from "next/navigation";
import { requireTenantId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import EditEmployeeForm from "./EditEmployeeForm";
import AddDocumentForm from "./AddDocumentForm";
import AddWageRateForm from "./AddWageRateForm";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tenantId = await requireTenantId();
  const { id } = await params;

  const [employee, locations] = await Promise.all([
    prisma.employee.findFirst({
      where: { id, tenantId },
      include: {
        location: true,
        documents: { orderBy: { uploadedAt: "desc" } },
        wageRates: { orderBy: { effectiveFrom: "desc" } },
      },
    }),
    prisma.location.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!employee) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {employee.firstName} {employee.lastName}
      </h1>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-4 text-lg font-semibold">Profile</h2>
        <EditEmployeeForm employee={employee} locations={locations} />
      </section>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-4 text-lg font-semibold">Documents</h2>
        <div className="mb-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Uploaded</th>
                <th className="px-4 py-2 font-medium">Expires</th>
              </tr>
            </thead>
            <tbody>
              {employee.documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                    No documents yet.
                  </td>
                </tr>
              )}
              {employee.documents.map((doc) => (
                <tr key={doc.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-4 py-2">{doc.type}</td>
                  <td className="px-4 py-2">
                    {doc.fileUrl ? (
                      <a href={doc.fileUrl} className="underline" target="_blank" rel="noreferrer">
                        {doc.fileName}
                      </a>
                    ) : (
                      doc.fileName
                    )}
                  </td>
                  <td className="px-4 py-2">{doc.uploadedAt.toLocaleDateString()}</td>
                  <td className="px-4 py-2">{doc.expiresAt ? doc.expiresAt.toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddDocumentForm employeeId={employee.id} />
      </section>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-4 text-lg font-semibold">Wage rate history</h2>
        <div className="mb-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Hourly rate</th>
                <th className="px-4 py-2 font-medium">Overtime multiplier</th>
                <th className="px-4 py-2 font-medium">Effective from</th>
              </tr>
            </thead>
            <tbody>
              {employee.wageRates.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                    No wage rates yet.
                  </td>
                </tr>
              )}
              {employee.wageRates.map((rate) => (
                <tr key={rate.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-4 py-2">{rate.hourlyRate.toString()}</td>
                  <td className="px-4 py-2">{rate.overtimeMultiplier.toString()}</td>
                  <td className="px-4 py-2">{rate.effectiveFrom.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddWageRateForm employeeId={employee.id} />
      </section>
    </div>
  );
}
