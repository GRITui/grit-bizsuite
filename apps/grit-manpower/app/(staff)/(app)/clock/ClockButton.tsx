"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ClockButtonProps {
  employeeId: string;
  isClockedIn: boolean;
}

export default function ClockButton({ employeeId, isClockedIn }: ClockButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(
        isClockedIn ? "/api/timeclock/clock-out" : "/api/timeclock/clock-in",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong");
        return;
      }

      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className={
          isClockedIn
            ? "rounded-lg border border-zinc-300 px-6 py-4 text-base font-semibold text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-white"
            : "rounded-lg bg-accent-600 px-6 py-4 text-base font-semibold text-white hover:bg-accent-700 disabled:opacity-50 dark:bg-accent-500 dark:hover:bg-accent-400 dark:text-zinc-950"
        }
      >
        {submitting ? "Working…" : isClockedIn ? "Clock Out" : "Clock In"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
