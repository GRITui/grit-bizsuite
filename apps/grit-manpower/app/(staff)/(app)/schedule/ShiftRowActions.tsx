"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

export default function ShiftRowActions({
  shiftId,
  status,
  employeeId,
  employees,
}: {
  shiftId: string;
  status: string;
  employeeId: string | null;
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patchShift(body: Record<string, unknown>) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Update failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {employeeId === null && (
          <select
            defaultValue=""
            disabled={submitting}
            onChange={(e) => {
              if (e.target.value) {
                patchShift({ employeeId: e.target.value });
              }
            }}
            className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Assign…</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </select>
        )}

        {status !== "cancelled" && status !== "completed" && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => patchShift({ status: "cancelled" })}
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
