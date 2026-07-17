"use client";

import { useMemo, useState } from "react";
import type { CatalogProductDTO } from "./types";
import { formatMoney } from "./format";

export interface ProductPickerSelection {
  productId: string;
  variantId: string | null;
  addOnIds: string[];
  quantity: number;
}

export default function ProductPicker({
  product,
  submitting,
  onCancel,
  onConfirm,
}: {
  product: CatalogProductDTO;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (selection: ProductPickerSelection) => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(
    product.variants[0]?.id ?? null,
  );
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  const unitPrice = useMemo(() => {
    const variant = product.variants.find((v) => v.id === variantId);
    const addOnsTotal = product.addOns
      .filter((a) => addOnIds.includes(a.id))
      .reduce((sum, a) => sum + a.price, 0);
    return product.basePrice + (variant?.priceDelta ?? 0) + addOnsTotal;
  }, [product, variantId, addOnIds]);

  function toggleAddOn(id: string) {
    setAddOnIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-xl bg-white p-5 sm:rounded-xl dark:bg-zinc-950">
        <div>
          <h3 className="text-lg font-semibold">{product.name}</h3>
          {product.description && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{product.description}</p>
          )}
        </div>

        {product.variants.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Size / variant</legend>
            {product.variants.map((v) => (
              <label
                key={v.id}
                className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="variant"
                    checked={variantId === v.id}
                    onChange={() => setVariantId(v.id)}
                  />
                  {v.name}
                </span>
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  {v.priceDelta === 0
                    ? "—"
                    : `${v.priceDelta > 0 ? "+" : ""}${formatMoney(v.priceDelta)}`}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {product.addOns.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Add-ons</legend>
            {product.addOns.map((a) => (
              <label
                key={a.id}
                className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={addOnIds.includes(a.id)}
                    onChange={() => toggleAddOn(a.id)}
                  />
                  {a.name}
                </span>
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                  +{formatMoney(a.price)}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Quantity</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-8 w-8 rounded border border-zinc-300 text-lg leading-none dark:border-zinc-700"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-6 text-center tabular-nums">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              className="h-8 w-8 rounded border border-zinc-300 text-lg leading-none dark:border-zinc-700"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Line total</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(unitPrice * quantity)}
          </span>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() =>
              onConfirm({ productId: product.id, variantId, addOnIds, quantity })
            }
            className="flex-1 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {submitting ? "Adding…" : "Add to order"}
          </button>
        </div>
      </div>
    </div>
  );
}
