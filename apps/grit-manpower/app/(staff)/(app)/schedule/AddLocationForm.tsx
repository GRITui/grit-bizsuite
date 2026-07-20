"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddLocationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to add location");
        return;
      }

      setName("");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
    >
      <h2 className="text-lg font-semibold tracking-tight">Add a location</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        You need at least one location before you can schedule shifts.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        Location name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Main Store"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {submitting ? "Adding…" : "Add location"}
      </button>
    </form>
  );
}
