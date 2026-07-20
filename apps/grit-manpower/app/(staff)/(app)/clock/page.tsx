import { prisma } from "@/lib/prisma";
import { requireTenantId } from "@/lib/tenant";
import ClockButton from "./ClockButton";

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(from: Date): string {
  const ms = Date.now() - from.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatDuration(clockIn: Date, clockOut: Date, breakMinutes: number): string {
  const totalMinutes = Math.max(
    0,
    Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000) - breakMinutes,
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export default async function ClockPage() {
  const tenantId = await requireTenantId();

  const [employees, openEntries, recentClosedEntries] = await Promise.all([
    prisma.employee.findMany({
      where: { tenantId, status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.timeEntry.findMany({
      where: { tenantId, status: "open", clockOut: null },
      select: { id: true, employeeId: true, clockIn: true },
    }),
    prisma.timeEntry.findMany({
      where: { tenantId, status: "closed" },
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        breakMinutes: true,
        employee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { clockIn: "desc" },
      take: 20,
    }),
  ]);

  const openEntryByEmployee = new Map(openEntries.map((entry) => [entry.employeeId, entry]));

  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <section>
        <h1 className="mb-4 text-2xl font-bold tracking-tight">Time Clock</h1>
        <div className="flex flex-col gap-3">
          {employees.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No active employees.</p>
          )}
          {employees.map((employee) => {
            const openEntry = openEntryByEmployee.get(employee.id);
            return (
              <div
                key={employee.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div>
                  <p className="text-lg font-medium">
                    {employee.firstName} {employee.lastName}
                  </p>
                  {openEntry && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Clocked in at {formatTime(openEntry.clockIn)} ({formatElapsed(openEntry.clockIn)} elapsed)
                    </p>
                  )}
                </div>
                <ClockButton employeeId={employee.id} isClockedIn={Boolean(openEntry)} />
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent activity</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Clock in</th>
                <th className="px-4 py-2 font-medium">Clock out</th>
                <th className="px-4 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {recentClosedEntries.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400" colSpan={4}>
                    No activity yet.
                  </td>
                </tr>
              )}
              {recentClosedEntries.map((entry) => (
                <tr key={entry.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-4 py-2">
                    {entry.employee.firstName} {entry.employee.lastName}
                  </td>
                  <td className="px-4 py-2">{formatTime(entry.clockIn)}</td>
                  <td className="px-4 py-2">{entry.clockOut ? formatTime(entry.clockOut) : "—"}</td>
                  <td className="px-4 py-2">
                    {entry.clockOut
                      ? formatDuration(entry.clockIn, entry.clockOut, entry.breakMinutes)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
