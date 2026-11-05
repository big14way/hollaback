"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";

/** Recovered revenue that ticks up when a new recovery lands. */
export function Counter({ value, currency }: { value: number; currency: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || begin === value) {
      setShown(value);
      from.current = value;
      return;
    }
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1200);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(begin + (value - begin) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className="counter">{money(shown, currency)}</span>;
}
