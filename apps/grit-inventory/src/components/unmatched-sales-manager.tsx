"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type UnmatchedSaleItemRow = {
  id: string;
  sku: string;
  quantity: number;
  orderReference: string | null;
  occurredAt: string;
};

const smallButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** Resolve button for a single row on /admin/unmatched-sales — PATCHes the
 * row resolved once staff have reconciled the stock discrepancy by hand
 * (BACKLOG.md, POS<->Inventory SKU alignment, approach 3). */
export function ResolveUnmatchedSaleButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/unmatched-sales/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to resolve");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={handleResolve} disabled={busy} className={smallButtonClass}>
        {busy ? "Resolving…" : "Mark resolved"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
