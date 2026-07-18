"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogCategoryDTO, CatalogProductDTO, OrderDTO } from "./types";
import { formatMoney } from "./format";
import {
  addOrderLine,
  cancelOrder,
  removeOrderLine,
  tenderOrder,
  updateOrderLineQuantity,
} from "./api";
import ProductPicker, { type ProductPickerSelection } from "./ProductPicker";
import CartPanel from "./CartPanel";
import TenderPanel from "./TenderPanel";

const STATUS_LABEL: Record<OrderDTO["status"], string> = {
  open: "Open",
  tendered: "Partially paid",
  closed: "Closed",
  cancelled: "Cancelled",
};

export default function OrderBuilder({
  initialOrder,
  catalog,
}: {
  initialOrder: OrderDTO;
  catalog: CatalogCategoryDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [activeCategoryId, setActiveCategoryId] = useState(catalog[0]?.id ?? "");
  const [pickerProduct, setPickerProduct] = useState<CatalogProductDTO | null>(null);
  const [showTender, setShowTender] = useState(false);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChangeDue, setLastChangeDue] = useState<number | null>(null);

  const editable = order.status === "open";
  const activeCategory = useMemo(
    () => catalog.find((c) => c.id === activeCategoryId) ?? catalog[0] ?? null,
    [catalog, activeCategoryId],
  );

  function handleProductTap(product: CatalogProductDTO) {
    if (!editable) return;
    if (product.variants.length === 0 && product.addOns.length === 0) {
      void submitLine({ productId: product.id, variantId: null, addOnIds: [], quantity: 1 });
    } else {
      setPickerProduct(product);
    }
  }

  async function submitLine(selection: ProductPickerSelection) {
    setPending(true);
    setError(null);
    try {
      const { order: updated } = await addOrderLine(order.id, selection);
      setOrder(updated);
      setPickerProduct(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add item");
    } finally {
      setPending(false);
    }
  }

  async function handleIncrement(lineId: string, quantity: number) {
    setBusyLineId(lineId);
    setError(null);
    try {
      const { order: updated } = await updateOrderLineQuantity(order.id, lineId, quantity + 1);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update item");
    } finally {
      setBusyLineId(null);
    }
  }

  async function handleDecrement(lineId: string, quantity: number) {
    if (quantity <= 1) {
      return handleRemove(lineId);
    }
    setBusyLineId(lineId);
    setError(null);
    try {
      const { order: updated } = await updateOrderLineQuantity(order.id, lineId, quantity - 1);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update item");
    } finally {
      setBusyLineId(null);
    }
  }

  async function handleRemove(lineId: string) {
    setBusyLineId(lineId);
    setError(null);
    try {
      const { order: updated } = await removeOrderLine(order.id, lineId);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove item");
    } finally {
      setBusyLineId(null);
    }
  }

  async function handleTender(input: { tenderType: "cash" | "card" | "qr_pay"; amount: number }) {
    setPending(true);
    setError(null);
    try {
      const { order: updated, changeDue } = await tenderOrder(order.id, input);
      setOrder(updated);
      setLastChangeDue(changeDue);
      if (updated.status === "closed") {
        setShowTender(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment");
    } finally {
      setPending(false);
    }
  }

  async function handleCancelOrder() {
    if (!window.confirm("Cancel this order? This can't be undone.")) return;
    setPending(true);
    setError(null);
    try {
      await cancelOrder(order.id);
      router.push("/pos");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel order");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 md:flex-row md:p-6">
      {/* Catalog */}
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {order.tableLabel ?? "Walk-in / counter"}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Order #{order.id.slice(-6)} · {STATUS_LABEL[order.status]}
            </p>
          </div>
          <button
            onClick={() => router.push("/pos")}
            className="text-sm text-zinc-500 underline dark:text-zinc-400"
          >
            Back to orders
          </button>
        </div>

        {!editable && (
          <p className="rounded bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {order.status === "closed"
              ? "This order is closed."
              : order.status === "cancelled"
                ? "This order was cancelled."
                : "Payment in progress — items are locked."}
          </p>
        )}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {catalog.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategoryId(category.id)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ${
                activeCategory?.id === category.id
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {activeCategory?.products.map((product) => (
            <button
              key={product.id}
              disabled={!editable}
              onClick={() => handleProductTap(product)}
              className="flex flex-col items-start gap-1 rounded-lg border border-zinc-200 p-3 text-left disabled:opacity-50 dark:border-zinc-800"
            >
              <span className="text-sm font-medium">{product.name}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatMoney(product.basePrice)}
              </span>
            </button>
          ))}
          {activeCategory?.products.length === 0 && (
            <p className="col-span-full text-sm text-zinc-500 dark:text-zinc-400">
              No products in this category.
            </p>
          )}
        </div>
      </div>

      {/* Cart */}
      <div className="flex w-full flex-col gap-4 rounded-lg border border-zinc-200 p-4 md:w-80 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Cart</h2>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="max-h-[50vh] overflow-y-auto">
          <CartPanel
            order={order}
            editable={editable}
            busyLineId={busyLineId}
            onIncrement={handleIncrement}
            onDecrement={handleDecrement}
            onRemove={handleRemove}
          />
        </div>

        <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Subtotal</span>
            <span className="tabular-nums">{formatMoney(order.subtotal)}</span>
          </div>
          {order.paidTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Paid</span>
              <span className="tabular-nums">{formatMoney(order.paidTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <span>Balance due</span>
            <span className="tabular-nums">{formatMoney(order.balanceDue)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            disabled={order.lines.length === 0 || order.status === "closed" || order.status === "cancelled" || pending}
            onClick={() => setShowTender(true)}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            Tender payment
          </button>
          {editable && (
            <button
              onClick={handleCancelOrder}
              disabled={pending}
              className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
            >
              Cancel order
            </button>
          )}
        </div>
      </div>

      {pickerProduct && (
        <ProductPicker
          product={pickerProduct}
          submitting={pending}
          onCancel={() => setPickerProduct(null)}
          onConfirm={submitLine}
        />
      )}

      {showTender && (
        <TenderPanel
          order={order}
          submitting={pending}
          lastChangeDue={lastChangeDue}
          onCancel={() => setShowTender(false)}
          onSubmit={handleTender}
        />
      )}
    </div>
  );
}
