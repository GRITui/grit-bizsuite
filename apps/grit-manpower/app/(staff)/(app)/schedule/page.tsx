import { requireTenantId } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import AddLocationForm from "./AddLocationForm";
import AddShiftForm from "./AddShiftForm";
import ShiftRowActions from "./ShiftRowActions";

const WINDOW_DAYS = 14;

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SchedulePage() {
  const tenantId = await requireTenantId();

  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [locations, employees, shifts] = await Promise.all([
    prisma.location.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.employee.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.shift.findMany({
      where: { tenantId, startsAt: { gte: now, lte: windowEnd } },
      orderBy: { startsAt: "asc" },
      include: {
        location: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  if (locations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <AddLocationForm />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Shifts for the next {WINDOW_DAYS} days.
        </p>
      </div>

      <AddShiftForm locations={locations} employees={employees} />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2">Location</th>
              <th className="px-4 py-2">Employee</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Start</th>
              <th className="px-4 py-2">End</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shifts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No shifts scheduled in this window.
                </td>
              </tr>
            )}
            {shifts.map((shift) => (
              <tr key={shift.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">{shift.location.name}</td>
                <td className="px-4 py-2">
                  {shift.employee
                    ? `${shift.employee.firstName} ${shift.employee.lastName}`
                    : <span className="text-zinc-500 dark:text-zinc-400">Open</span>}
                </td>
                <td className="px-4 py-2">{shift.role ?? "—"}</td>
                <td className="px-4 py-2">{formatDateTime(shift.startsAt)}</td>
                <td className="px-4 py-2">{formatDateTime(shift.endsAt)}</td>
                <td className="px-4 py-2 capitalize">{shift.status}</td>
                <td className="px-4 py-2">
                  <ShiftRowActions
                    shiftId={shift.id}
                    status={shift.status}
                    employeeId={shift.employeeId}
                    employees={employees}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
