import Link from "next/link";
import { requireTenantId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import AddEmployeeForm from "./AddEmployeeForm";

export default async function EmployeesPage() {
  const tenantId = await requireTenantId();

  const [employees, locations] = await Promise.all([
    prisma.employee.findMany({
      where: { tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        department: true,
        status: true,
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.location.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight">Employees</h1>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Position</th>
              <th className="px-4 py-2 font-medium">Department</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Location</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No employees yet.
                </td>
              </tr>
            )}
            {employees.map((employee) => (
              <tr
                key={employee.id}
                className="border-t border-zinc-200 dark:border-zinc-800"
              >
                <td className="px-4 py-2">
                  <Link
                    href={`/employees/${employee.id}`}
                    className="font-medium underline"
                  >
                    {employee.firstName} {employee.lastName}
                  </Link>
                </td>
                <td className="px-4 py-2">{employee.position}</td>
                <td className="px-4 py-2">{employee.department ?? "—"}</td>
                <td className="px-4 py-2 capitalize">{employee.status}</td>
                <td className="px-4 py-2">{employee.location?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-4 text-lg font-semibold">Add employee</h2>
        <AddEmployeeForm locations={locations} />
      </div>
    </div>
  );
}
