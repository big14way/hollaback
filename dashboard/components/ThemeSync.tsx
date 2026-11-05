"use client";

import { useEffect } from "react";

/** Keeps AG Grid's colour scheme (data-ag-theme-mode) in step with the OS theme. */
export function ThemeSync() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.agThemeMode = mq.matches ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return null;
}
