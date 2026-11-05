"use client";

import { useEffect, useState } from "react";
import { fetchConfig } from "./api";
import type { PublicConfig } from "./types";

let cached: Promise<PublicConfig> | null = null;

/** The server's public config, fetched once per page load and shared by the sidebar and pages. */
export function useWorkspace(): { config: PublicConfig | null; offline: boolean } {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let alive = true;
    cached ??= fetchConfig();
    cached
      .then((c) => alive && setConfig(c))
      .catch(() => {
        cached = null;
        if (alive) setOffline(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { config, offline };
}

export function agentLabel(agent: string | undefined): string {
  if (!agent) return "";
  const model = agent.replace(/^claude:/, "");
  if (agent.startsWith("scripted")) return "Scripted agent";
  return model
    .replace(/^claude-/, "Claude ")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/(^|\s)([a-z])/g, (m) => m.toUpperCase());
}
