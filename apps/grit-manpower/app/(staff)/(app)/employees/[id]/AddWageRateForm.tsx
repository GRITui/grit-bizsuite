"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddWageRateForm({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [hourlyRate, setHourlyRate] = useState("");
  const [overtimeMultiplier, setOvertimeMultiplier] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/employees/${employeeId}/wage-rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hourlyRate,
          effectiveFrom,
          overtimeMultiplier: overtimeMultiplier || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to add wage rate");
        return;
      }

      setHourlyRate("");
      setOvertimeMultiplier("");
      setEffectiveFrom("");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Hourly rate
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Overtime multiplier
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="1.5"
            value={overtimeMultiplier}
            onChange={(e) => setOvertimeMultiplier(e.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Effective from
          <input
            required
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {submitting ? "Adding…" : "Add wage rate"}
      </button>
    </form>
  );
}
