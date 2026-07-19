"use client";

import { useState } from "react";
import { createStore } from "./api";
import type { StoreDTO } from "./types";

/**
 * Minimal Store admin: view existing locations, add a new one. This is
 * intentionally not a full multi-location UI suite (no editing, no
 * deactivating, no default-store reassignment) — closing a documented
 * low-urgency gap (BACKLOG.md P1 "No Location model in POS"), not building
 * out the whole feature. Nothing in checkout links an order to a
 * non-default store yet; that's a follow-up stage.
 */
export default function StoresApp({ initialStores }: { initialStores: StoreDTO[] }) {
  const [stores, setStores] = useState<StoreDTO[]>(initialStores);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!name.trim() || !code.trim()) {
      setError("Name and code are both required");
      return;
    }

    setSubmitting(true);
    try {
      const { store } = await createStore({ name: name.trim(), code: code.trim() });
      setStores((prev) => [...prev, store]);
      setName("");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create store");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Locations</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Every sale is attributed to a location for cross-app reporting. New
          tenants start with a single default location — add more here only
          if this business actually operates more than one physical site.
        </p>

        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Default</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{store.name}</td>
                  <td className="px-3 py-2 tabular-nums">{store.code}</td>
                  <td className="px-3 py-2">
                    {store.isDefault ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Default
                      </span>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                    {new Date(store.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Add a location</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Downtown"
              className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Code
            <input
              required
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="DOWNTOWN"
              className="rounded border border-zinc-300 px-3 py-2 uppercase dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {submitting ? "Adding…" : "Add location"}
          </button>
        </form>
      </section>
    </div>
  );
}
