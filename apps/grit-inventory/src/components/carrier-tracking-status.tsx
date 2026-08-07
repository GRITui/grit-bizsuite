"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui";

/**
 * Carrier tracking chip for the parcel label admin page. Renders whatever
 * status is already on the row (server-rendered, no network call needed to
 * show something) and offers a "Refresh" button that hits
 * `GET /api/parcel-labels/[id]/tracking` to pull a live status from the
 * active carrier adapter (mock by default — see `src/lib/carrier/`).
 */
export function CarrierTrackingStatus({
  labelId,
  carrierTrackingId,
  carrierStatus,
  carrierStatusUpdatedAt,
}: {
  labelId: string;
  carrierTrackingId: string | null;
  carrierStatus: string | null;
  carrierStatusUpdatedAt: string | null;
}) {
  const [trackingId, setTrackingId] = useState(carrierTrackingId);
  const [status, setStatus] = useState(carrierStatus);
  const [updatedAt, setUpdatedAt] = useState(carrierStatusUpdatedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/parcel-labels/${labelId}/tracking`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to refresh tracking status");
      setTrackingId(data.label?.carrierTrackingId ?? null);
      setStatus(data.label?.carrierStatus ?? null);
      setUpdatedAt(data.label?.carrierStatusUpdatedAt ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (!trackingId) {
    return (
      <div className="no-print mt-4 text-xs text-zinc-500">
        No carrier shipment yet (carrier call failed or is still pending).
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-zinc-300 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase text-zinc-500">Carrier tracking</div>
          <div className="mt-0.5 font-mono text-sm">{trackingId}</div>
        </div>
        <div className="flex items-center gap-2">
          {status && <StatusBadge status={status} />}
          <button
            type="button"
            disabled={loading}
            onClick={refresh}
            className="no-print rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {updatedAt && (
        <div className="mt-1 text-xs text-zinc-500">
          Updated {new Date(updatedAt).toLocaleString()}
        </div>
      )}
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  );
}
