"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { agentLabel, useWorkspace } from "@/lib/workspace";
import { LogoMark } from "./Logo";

const NAV = [
  { href: "/", label: "Recoveries", match: (p: string) => p === "/" || p.startsWith("/cart") },
  { href: "/playbook/", label: "Playbook", match: (p: string) => p.startsWith("/playbook") },
];

function Icon({ name }: { name: string }) {
  if (name === "Recoveries")
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M3 15.5V9.5M8 15.5V5M13 15.5v-4M17 15.5V7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M5 3.5h7.5L16 7v9.5H5zM12.5 3.5V7H16M8 11h5M8 14h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname() || "/";
  const { config, offline } = useWorkspace();
  const env = config?.mock ? "Simulated PayPal" : config?.environment === "live" ? "PayPal live" : "PayPal sandbox";
  const channel = config?.channel === "whatsapp" ? "WhatsApp" : config ? "Console channel" : "";

  return (
    <aside className="sidebar">
      <Link href="/" className="logo">
        <LogoMark />
        <span>Hollaback</span>
      </Link>

      <div className="workspace">
        <span className="ws-avatar" aria-hidden="true">
          {(config?.merchant.name ?? "K").slice(0, 1)}
        </span>
        <span className="ws-text">
          <strong>{config?.merchant.name ?? "Loading…"}</strong>
          <span>{config ? `${config.merchant.currency} store` : " "}</span>
        </span>
      </div>

      <nav aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`nav-link${n.match(pathname) ? " active" : ""}`} aria-current={n.match(pathname) ? "page" : undefined}>
            <Icon name={n.label} />
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="connections" aria-label="Connections">
        <span className="conn-title">Connections</span>
        {offline ? (
          <span className="conn bad">Server unreachable</span>
        ) : (
          <>
            <span className={`conn${config ? " ok" : ""}`}>{env || "PayPal"}</span>
            <span className={`conn${config ? " ok" : ""}`}>{channel || "Messaging"}</span>
            <span className={`conn${config ? " ok" : ""}`}>{agentLabel(config?.agent) || "Agent"}</span>
          </>
        )}
      </div>
    </aside>
  );
}
