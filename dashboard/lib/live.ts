"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "./api";

const DEBOUNCE_MS = 150;

/**
 * Calls `onChange` whenever the server reports a store write (server-sent events on /api/stream).
 * One webhook causes several writes, so bursts are coalesced into a single refetch.
 * While the stream is down the hook falls back to polling every `fallbackMs`.
 * Returns whether the push stream is currently connected.
 */
export function useLiveUpdates(onChange: () => void, opts: { cartId?: string; fallbackMs?: number } = {}): boolean {
  const { cartId, fallbackMs = 10_000 } = opts;
  const cb = useRef(onChange);
  cb.current = onChange;
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), DEBOUNCE_MS);
    };
    const set = (v: boolean) => {
      connectedRef.current = v;
      setConnected(v);
    };

    let es: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      es = new EventSource(`${API_URL}/api/stream${cartId ? `?cartId=${encodeURIComponent(cartId)}` : ""}`);
      es.addEventListener("ready", () => {
        set(true);
        fire(); // catch up on anything missed while disconnected
      });
      es.addEventListener("change", fire);
      es.onerror = () => set(false); // EventSource reconnects on its own
    }
    const poll = setInterval(() => {
      if (!connectedRef.current) cb.current();
    }, fallbackMs);

    return () => {
      es?.close();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      connectedRef.current = false;
    };
  }, [cartId, fallbackMs]);

  return connected;
}
