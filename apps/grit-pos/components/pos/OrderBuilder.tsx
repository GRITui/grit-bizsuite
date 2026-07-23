"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogCategoryDTO, CatalogProductDTO, OrderDTO, OrderLineDTO } from "./types";
import { formatMoney } from "./format";
import {
  addOrderLine,
  cancelOrder,
  removeOrderLine,
  tenderOrder,
  updateOrderLineQuantity,
} from "./api";
import { newExternalRef } from "./offlineQueue";
import ProductPicker, { type ProductPickerSelection } from "./ProductPicker";
import CartPanel from "./CartPanel";
import TenderPanel from "./TenderPanel";

const STATUS_LABEL: Record<OrderDTO["status"], string> = {
  open: "Open",
  tendered: "Partially paid",
  closed: "Closed",
  cancelled: "Cancelled",
};

/**
 * Builds a client-only OrderLineDTO for a line just queued offline, purely
 * from catalog data already on hand (no server round-trip yet) — same idea
 * as tenderOrder's queued-state notice, but a queued line needs to actually
 * render in the cart. Marked `pending: true` so CartPanel disables
 * qty/remove controls until the real line lands via sync. Returns null if
 * the product/variant/add-ons can no longer be resolved from the catalog
 * (shouldn't happen — the selection just came from the catalog itself).
 */
function buildOptimisticLine(
  catalog: CatalogCategoryDTO[],
  selection: ProductPickerSelection,
): OrderLineDTO | null {
  const product = catalog.flatMap((c) => c.products).find((p) => p.id === selection.productId);
  if (!product) return null;
  const variant = selection.variantId
    ? (product.variants.find((v) => v.id === selection.variantId) ?? null)
    : null;
  const selectedAddOns = product.addOns.filter((a) => selection.addOnIds.includes(a.id));
  const unitPrice = product.basePrice + (variant?.priceDelta ?? 0);
  const addOnsTotal = selectedAddOns.reduce((sum, a) => sum + a.price, 0);
  return {
    id: `pending-${newExternalRef()}`,
    productId: product.id,
    productName: product.name,
    variantId: variant?.id ?? null,
    variantName: variant?.name ?? null,
    quantity: selection.quantity,
    unitPrice: unitPrice + addOnsTotal,
    lineTotal: (unitPrice + addOnsTotal) * selection.quantity,
    addOns: selectedAddOns.map((a) => ({ id: a.id, addOnId: a.id, name: a.name, price: a.price })),
    pending: true,
  };
}

export default function OrderBuilder({
  initialOrder,
  catalog,
  matrixEnabled = false,
  offlineEnabled = false,
}: {
  initialOrder: OrderDTO;
  catalog: CatalogCategoryDTO[];
  /** "retail.variant_matrix" plugin trait — attribute selectors in the picker. */
  matrixEnabled?: boolean;
  /** pos.offline_mode entitlement — queue tenders captured while offline. */
  offlineEnabled?: boolean;
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
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);

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

  /**
   * Barcode-scan entry point: a keyboard-wedge scanner types the code + a
   * trailing Enter into whatever input has focus, so a plain text input
   * submitting on Enter is all real retail scanner hardware needs — no
   * camera UI. Resolves the code against variant SKUs already present in
   * `catalog` (client-side lookup, no extra API call) and, on a match, goes
   * through the SAME submitLine path the tap flow uses (quantity 1, no
   * add-ons — add-ons aren't scannable). Shows a clear "not found" message
   * otherwise.
   */
  function handleScanSubmit() {
    const code = scanCode.trim();
    setScanCode("");
    if (!code || !editable) return;
    setScanError(null);
    for (const category of catalog) {
      for (const product of category.products) {
        const variant = product.variants.find(
          (v) => v.sku && v.sku.toLowerCase() === code.toLowerCase(),
        );
        if (variant) {
          void submitLine({ productId: product.id, variantId: variant.id, addOnIds: [], quantity: 1 });
          return;
        }
      }
    }
    setScanError(`No item found for barcode "${code}"`);
  }

  async function submitLine(selection: ProductPickerSelection) {
    setPending(true);
    setError(null);
    try {
      const result = await addOrderLine(order.id, selection, { queueOffline: offlineEnabled });
      if (result.queued) {
        // Offline capture: same pattern as handleTender's queued path, but
        // an added line needs to actually show up in the cart (not just a
        // notice) or staff can't keep building the order while offline.
        // Build a synthetic line from catalog data already on hand and
        // append it optimistically — the real, server-assigned line lands
        // once the sync loop (OfflineStatusChip) replays the queue.
        const optimisticLine = buildOptimisticLine(catalog, selection);
        setOrder((prev) =>
          optimisticLine
            ? {
                ...prev,
                lines: [...prev.lines, optimisticLine],
                subtotal: prev.subtotal + optimisticLine.lineTotal,
                balanceDue: prev.balanceDue + optimisticLine.lineTotal,
              }
            : prev,
        );
        setQueuedNotice("Offline — item queued. It will sync automatically when back online.");
        setPickerProduct(null);
        return;
      }
      setOrder(result.order);
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
      const result = await tenderOrder(order.id, input, { queueOffline: offlineEnabled });
      if (result.queued) {
        // Offline capture: the tender sits in the IndexedDB queue and the
        // sync loop (OfflineStatusChip) will replay it. Show queued state —
        // the order stays visually unchanged until the sync lands.
        setShowTender(false);
        setQueuedNotice(
          "Offline — payment queued. It will sync automatically when back online.",
        );
        return;
      }
      setOrder(result.order);
      setLastChangeDue(result.changeDue);
      if (result.order.status === "closed") {
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
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-row gap-4 p-6 max-md:flex-col max-md:p-4">
      {/* Catalog */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
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
            className="text-sm text-zinc-500 hover:text-accent-600 dark:text-zinc-400 dark:hover:text-accent-400"
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

        <div className="flex gap-2">
          <input
            type="text"
            value={scanCode}
            onChange={(e) => {
              setScanCode(e.target.value);
              setScanError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScanSubmit();
              }
            }}
            disabled={!editable}
            placeholder="Scan barcode…"
            aria-label="Scan barcode"
            className="flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="button"
            onClick={handleScanSubmit}
            disabled={!editable || !scanCode.trim()}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            Add
          </button>
        </div>
        {scanError && <p className="text-sm text-red-600 dark:text-red-400">{scanError}</p>}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {catalog.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategoryId(category.id)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ${
                activeCategory?.id === category.id
                  ? "bg-accent-600 text-white dark:bg-accent-500 dark:text-zinc-950"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2">
          {activeCategory?.products.map((product) => (
            <button
              key={product.id}
              disabled={!editable}
              onClick={() => handleProductTap(product)}
              className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-zinc-200 p-3 text-left disabled:opacity-50 dark:border-zinc-800"
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
      <div className="flex w-80 shrink-0 flex-col gap-4 rounded-lg border border-zinc-200 p-4 max-md:w-full dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Cart</h2>
        {queuedNotice && (
          <p className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
            {queuedNotice}
          </p>
        )}
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
          <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
            <span>Subtotal (excl. VAT)</span>
            <span className="tabular-nums">{formatMoney(order.subtotalExclVat)}</span>
          </div>
          <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
            <span>VAT ({order.vatRate}%)</span>
            <span className="tabular-nums">{formatMoney(order.vatAmount)}</span>
          </div>
          {order.vatExemptSubtotal > 0 && (
            <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
              <span>VAT-exempt items</span>
              <span className="tabular-nums">{formatMoney(order.vatExemptSubtotal)}</span>
            </div>
          )}
          {order.discountTotal > 0 && (
            <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
              <span
                title={order.discountsApplied.map((d) => `${d.name}: -${formatMoney(d.amount)}`).join("\n")}
              >
                Promotions
              </span>
              <span className="tabular-nums">-{formatMoney(order.discountTotal)}</span>
            </div>
          )}
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
            className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50 dark:bg-accent-500 dark:hover:bg-accent-400 dark:text-zinc-950"
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
          matrixEnabled={matrixEnabled}
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
