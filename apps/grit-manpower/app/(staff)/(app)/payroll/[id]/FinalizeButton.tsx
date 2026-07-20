"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FinalizeButton({ periodId }: { periodId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    if (!window.confirm("Finalize this payroll period? This cannot be undone.")) {
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/payroll/periods/${periodId}/finalize`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to finalize payroll");
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
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={submitting}
        className="rounded border border-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50 dark:border-white dark:text-white"
      >
        {submitting ? "Finalizing…" : "Finalize"}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
