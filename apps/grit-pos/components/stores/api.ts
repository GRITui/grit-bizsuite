"use client";

import type { StoreDTO } from "./types";

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

export function listStores(): Promise<{ stores: StoreDTO[] }> {
  return request("/api/stores");
}

export function createStore(input: { name: string; code: string }): Promise<{ store: StoreDTO }> {
  return request("/api/stores", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
