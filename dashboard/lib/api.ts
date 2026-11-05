import type { CartDetail, CartRow, Stats } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_HOLLABACK_API_URL || "http://localhost:4000").replace(/\/$/, "");

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

export const fetchCarts = () => get<{ carts: CartRow[] }>("/api/carts").then((d) => d.carts);
export const fetchStats = () => get<Stats>("/api/stats");
export const fetchCart = (id: string) => get<CartDetail>(`/api/carts/${encodeURIComponent(id)}`);

export async function replyAsShopper(cartId: string, body: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/carts/${encodeURIComponent(cartId)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `reply failed (${res.status})`);
}
