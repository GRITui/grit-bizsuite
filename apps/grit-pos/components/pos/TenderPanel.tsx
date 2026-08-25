"use client";

import { useMemo, useState } from "react";
import type { OrderDTO } from "./types";
import { formatMoney } from "./format";
import { buildTenderChips } from "./tenderChips";

type TenderType = "cash" | "card" | "qr_pay";

const TENDER_OPTIONS: { value: TenderType; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "qr_pay", label: "QR pay" },
];

export default function TenderPanel({
  order,
  submitting,
  lastChangeDue,
  submitError = null,
  onCancel,
  onSubmit,
}: {
  order: OrderDTO;
  submitting: boolean;
  lastChangeDue: number | null;
  /** Failure message from the last tender attempt (issue #42) — rendered inline with a retry affordance. */
  submitError?: string | null;
  onCancel: () => void;
  onSubmit: (input: { tenderType: TenderType; amount: number }) => void;
}) {
  const [tenderType, setTenderType] = useState<TenderType>("cash");
  const [amount, setAmount] = useState(order.balanceDue.toFixed(2));

  const parsedAmount = Number(amount);
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const tenderChips = useMemo(
    () => buildTenderChips(order.balanceDue),
    [order.balanceDue],
  );

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-t-xl bg-white p-5 sm:rounded-xl dark:bg-zinc-950">
        <h3 className="text-lg font-semibold">Tender payment</h3>

        <div className="flex justify-between text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Order subtotal</span>
          <span className="tabular-nums">{formatMoney(order.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>Subtotal (excl. VAT)</span>
          <span className="tabular-nums">{formatMoney(order.subtotalExclVat)}</span>
        </div>
        <div className="flex justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>VAT ({order.vatRate}%)</span>
          <span className="tabular-nums">{formatMoney(order.vatAmount)}</span>
        </div>
        {order.vatExemptSubtotal > 0 && (
          <div className="flex justify-between text-sm text-zinc-500 dark:text-zinc-400">
            <span>VAT-exempt items</span>
            <span className="tabular-nums">{formatMoney(order.vatExemptSubtotal)}</span>
          </div>
        )}
        {order.discountTotal > 0 && (
          <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
            <span>Promotions</span>
            <span className="tabular-nums">-{formatMoney(order.discountTotal)}</span>
          </div>
        )}
        {order.paidTotal > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Already paid</span>
            <span className="tabular-nums">{formatMoney(order.paidTotal)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <span>Balance due</span>
          <span className="tabular-nums">{formatMoney(order.balanceDue)}</span>
        </div>

        {lastChangeDue !== null && lastChangeDue > 0 && (
          <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Change due from last payment: {formatMoney(lastChangeDue)}
          </p>
        )}

        <fieldset className="flex gap-2">
          <legend className="sr-only">Tender type</legend>
          {TENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTenderType(opt.value)}
              className={`flex-1 rounded border px-3 py-2 text-sm font-medium ${
                tenderType === opt.value
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          Amount tendered
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 text-lg dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {/* Quick-cash chips (issue #41): one tap fills the amount field; manual
            typing keeps working since both write the same `amount` state.
            Disabled while submitting so a mid-flight retry can't be set up
            against an amount that changed after the click. */}
        {tenderChips.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {tenderChips.map((chip) => (
              <button
                key={`${chip.kind}-${chip.value}`}
                type="button"
                disabled={submitting}
                onClick={() => setAmount(chip.value.toFixed(2))}
                className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium tabular-nums disabled:opacity-50 dark:border-zinc-700"
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              disabled={submitting}
              onClick={() => setAmount("")}
              className="rounded border border-dashed border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400"
            >
              Clear
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Close
          </button>
          <button
            type="button"
            disabled={submitting || !isValidAmount}
            onClick={() => onSubmit({ tenderType, amount: parsedAmount })}
            className="flex-1 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {submitting ? "Processing…" : "Record payment"}
          </button>
        </div>

        {/* Inline failure feedback (issue #42). The wrapper stays mounted so
            assistive tech has an existing aria-live=polite region to announce
            into when submitError flips from null to a message. Retry re-runs
            the same guarded submit with the CURRENT form values, so the
            cashier can also correct the amount/tender type before retrying.
            Double-submit safety: both this button and "Record payment" are
            disabled while the parent holds `submitting` (set before the
            request starts, cleared only after success/failure settles). */}
        <div aria-live="polite">
          {submitError && (
            <div className="flex flex-col gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-300">
              <p>{submitError}</p>
              <button
                type="button"
                disabled={submitting || !isValidAmount}
                onClick={() => onSubmit({ tenderType, amount: parsedAmount })}
                className="self-start rounded border border-red-300 px-3 py-1.5 font-medium text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300"
              >
                Retry payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
