"use client";

import type { OrderDTO } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function createOrder(tableId: string | null): Promise<{ order: OrderDTO }> {
  return request("/api/orders", {
    method: "POST",
    body: JSON.stringify({ tableId }),
  });
}

export function cancelOrder(orderId: string): Promise<{ order: OrderDTO | null }> {
  return request(`/api/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled" }),
  });
}

export function addOrderLine(
  orderId: string,
  input: { productId: string; variantId: string | null; addOnIds: string[]; quantity: number },
): Promise<{ order: OrderDTO }> {
  return request(`/api/orders/${orderId}/lines`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateOrderLineQuantity(
  orderId: string,
  lineId: string,
  quantity: number,
): Promise<{ order: OrderDTO }> {
  return request(`/api/orders/${orderId}/lines/${lineId}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity }),
  });
}

export function removeOrderLine(orderId: string, lineId: string): Promise<{ order: OrderDTO }> {
  return request(`/api/orders/${orderId}/lines/${lineId}`, { method: "DELETE" });
}

export function tenderOrder(
  orderId: string,
  input: { tenderType: "cash" | "card" | "qr_pay"; amount: number },
): Promise<{ order: OrderDTO; changeDue: number }> {
  return request(`/api/orders/${orderId}/tender`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
