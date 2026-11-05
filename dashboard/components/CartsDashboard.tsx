"use client";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCarts, fetchStats, API_URL } from "@/lib/api";
import { itemsSummary, maskPhone, money, outcomeKey, relativeTime } from "@/lib/format";
import { useLiveUpdates } from "@/lib/live";
import { groupByOutcome, toDataRows, type GridRow, type GroupHeaderRow } from "@/lib/grouping";
import type { CartRow, Stats } from "@/lib/types";
import { OutcomeBadge } from "./Badge";
import { Counter } from "./Counter";

ModuleRegistry.registerModules([AllCommunityModule]);

const LEFT_VIA: Record<string, string> = {
  cancel: "Closed PayPal",
  idle: "Went idle",
  hidden: "Left the tab",
  exit_intent: "Exit intent",
  pagehide: "Closed the page",
  timeout: "Never paid",
};

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13.5,
  foregroundColor: "#1b1d22",
  backgroundColor: "#ffffff",
  headerBackgroundColor: "#fafaf8",
  headerTextColor: "#6b6f78",
  headerFontWeight: 500,
  headerFontSize: 12.5,
  borderColor: "#ebeae6",
  rowBorder: { color: "#f0efeb" },
  rowHoverColor: "#f7f7f4",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowHeight: 52,
  headerHeight: 40,
  cellHorizontalPadding: 18,
  accentColor: "#12553f",
});

function GroupHeader(props: ICellRendererParams<GridRow> & { onToggle: (key: string) => void }) {
  const g = props.data as GroupHeaderRow;
  return (
    <button type="button" className="group-row" onClick={() => props.onToggle(g.key)} aria-expanded={!g.collapsed}>
      <span className="chevron" aria-hidden>
        {g.collapsed ? "▸" : "▾"}
      </span>
      <OutcomeBadge outcome={g.key as Parameters<typeof OutcomeBadge>[0]["outcome"]} />
      <span className="group-count">
        {g.count} cart{g.count === 1 ? "" : "s"}
      </span>
      {g.recovered > 0 && <span className="group-money">{money(g.recovered)} recovered</span>}
    </button>
  );
}

/** Median minutes from abandonment to recovery, across recovered carts. */
function medianRecovery(carts: CartRow[]): string {
  const ms = carts
    .filter((c) => c.status === "recovered" && c.abandonedAt && c.recoveredAt)
    .map((c) => Date.parse(c.recoveredAt!) - Date.parse(c.abandonedAt!))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (!ms.length) return "–";
  const mid = ms[Math.floor(ms.length / 2)]!;
  const m = Math.floor(mid / 60_000);
  const sec = Math.round((mid % 60_000) / 1000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function Funnel({ stats }: { stats: Stats | null }) {
  const base = Math.max(stats?.abandoned ?? 0, 1);
  const steps = [
    { label: "Left checkout", value: stats?.abandoned ?? 0, note: "PayPal order still unpaid" },
    { label: "Messaged by the agent", value: stats?.contacted ?? 0, note: "only shoppers who opted in" },
    { label: "Paid through PayPal", value: stats?.recovered ?? 0, note: "confirmed by webhook" },
  ];
  return (
    <section className="card funnel" aria-label="Recovery funnel">
      <header className="card-head">
        <h2>Recovery funnel</h2>
      </header>
      <ol>
        {steps.map((st, i) => (
          <li key={st.label}>
            <div className="funnel-top">
              <span className="funnel-step">{i + 1}</span>
              <span className="funnel-label">{st.label}</span>
              <span className="funnel-value">{st.value}</span>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (st.value / base) * 100)}%` }} className={i === 2 ? "good" : ""} />
            </div>
            <span className="funnel-note">{st.note}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CartsDashboard() {
  const router = useRouter();
  const [carts, setCarts] = useState<CartRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [quick, setQuick] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([fetchCarts(), fetchStats()]);
      setCarts(c);
      setStats(s);
      setError(null);
      setUpdatedAt(Date.now());
    } catch {
      setError(`Can't reach the Hollaback server at ${API_URL}.`);
    }
  }, []);

  const live = useLiveUpdates(load);

  useEffect(() => {
    load();
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(clock);
  }, [load]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Shoppers still browsing or mid-checkout are not abandoned yet; keep them out of the table.
  const shown = useMemo(() => carts.filter((c) => c.abandonedAt || !["active", "pending"].includes(c.status)), [carts]);
  const rows: GridRow[] = useMemo(() => (grouped ? groupByOutcome(shown, collapsed) : toDataRows(shown)), [shown, grouped, collapsed]);

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        headerName: "Shopper",
        flex: 1.4,
        minWidth: 170,
        valueGetter: (p) => (p.data?.kind === "cart" ? [p.data.shopperName, maskPhone(p.data.shopperPhone)].filter(Boolean).join(" · ") || "Anonymous" : ""),
      },
      {
        headerName: "Items",
        flex: 1,
        minWidth: 120,
        valueGetter: (p) => (p.data?.kind === "cart" ? itemsSummary(p.data.items) : ""),
      },
      {
        headerName: "Total",
        width: 104,
        type: "rightAligned",
        valueGetter: (p) => (p.data?.kind === "cart" ? p.data.effectiveTotal : null),
        valueFormatter: (p) => (p.data?.kind === "cart" ? money(p.value as number, p.data.currency) + (p.data.discountPct ? ` (−${p.data.discountPct}%)` : "") : ""),
      },
      {
        headerName: "Left checkout",
        width: 124,
        valueGetter: (p) => (p.data?.kind === "cart" ? p.data.abandonedAt : null),
        valueFormatter: (p) => relativeTime(p.value as string | null),
        tooltipValueGetter: (p) => (p.value ? new Date(p.value as string).toLocaleString() : null),
        sort: undefined,
      },
      {
        headerName: "How they left",
        width: 136,
        valueGetter: (p) => (p.data?.kind === "cart" ? (p.data.abandonReason ?? "") : ""),
        valueFormatter: (p) => LEFT_VIA[p.value as string] ?? (p.value as string) ?? "",
      },
      {
        headerName: "Outcome",
        width: 164,
        valueGetter: (p) => (p.data?.kind === "cart" ? outcomeKey(p.data) : null),
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data?.kind === "cart" ? <OutcomeBadge outcome={outcomeKey(p.data)} /> : null,
      },
      {
        headerName: "Recovered",
        width: 112,
        type: "rightAligned",
        valueGetter: (p) => (p.data?.kind === "cart" && p.data.status === "recovered" ? p.data.recoveredAmount : null),
        valueFormatter: (p) => (p.value ? money(p.value as number) : ""),
        cellClass: "money-cell",
      },
      {
        headerName: "search",
        colId: "search",
        hide: true,
        valueGetter: (p) => p.data?.search ?? "",
        getQuickFilterText: (p) => (p.data?.search as string) ?? "",
      },
    ],
    [],
  );

  const onRowClicked = useCallback(
    (e: RowClickedEvent<GridRow>) => {
      if (e.data?.kind === "cart") router.push(`/cart/?id=${encodeURIComponent(e.data.id)}`);
    },
    [router],
  );

  const currency = stats?.currency ?? "USD";
  const rate = Math.round((stats?.recoveryRate ?? 0) * 100);

  return (
    <div className="dashboard">
      <header className="page-head">
        <div>
          <h1>Recoveries</h1>
          <p className="muted">PayPal checkouts that were left unfinished, and how each one was brought back.</p>
        </div>
        <span className={`live${error ? " off" : ""}`} aria-live="polite">
          <span className="dot" aria-hidden="true" />
          {error ? "Offline" : updatedAt ? (live ? "Live" : "Polling") : "Connecting"}
        </span>
      </header>

      <section className="kpis" aria-label="Recovery summary">
        <div className="kpi kpi-hero">
          <span className="kpi-label">Recovered revenue</span>
          <Counter value={stats?.recoveredRevenue ?? 0} currency={currency} />
          <span className="kpi-sub">
            {stats?.recovered ?? 0} of {stats?.abandoned ?? 0} abandoned checkouts paid
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Recovery rate</span>
          <span className="kpi-value">{rate}%</span>
          <span className="kpi-sub">of abandoned checkouts</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Median time to recover</span>
          <span className="kpi-value">{medianRecovery(carts)}</span>
          <span className="kpi-sub">from leaving checkout to paid</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">In conversation</span>
          <span className="kpi-value">{carts.filter((c) => c.status === "contacted").length}</span>
          <span className="kpi-sub">agent waiting on a reply</span>
        </div>
      </section>

      <div className="overview-grid">
        <section className="card table-card" aria-label="Abandoned checkouts">
          <header className="card-head">
            <h2>Abandoned checkouts</h2>
            <div className="toolbar">
              <input
                className="search"
                type="search"
                placeholder="Search shopper, item, order…"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                aria-label="Quick filter"
              />
              <label className="toggle">
                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by outcome
              </label>
            </div>
          </header>
          {error && <p className="error banner">{error}</p>}
          <div className="grid-wrap">
            <AgGridReact<GridRow>
              theme={theme}
              rowData={rows}
              columnDefs={columns}
              getRowId={(p) => p.data.id}
              isFullWidthRow={(p) => p.rowNode.data?.kind === "group"}
              fullWidthCellRenderer={GroupHeader}
              fullWidthCellRendererParams={{ onToggle: toggle }}
              quickFilterText={quick}
              includeHiddenColumnsInQuickFilter
              onRowClicked={onRowClicked}
              rowClassRules={{ "row-link": (p) => p.data?.kind === "cart" }}
              defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
              overlayNoRowsTemplate="No abandoned checkouts yet. When a shopper leaves a PayPal checkout, it appears here within a minute."
              domLayout="autoHeight"
              tooltipShowDelay={300}
            />
          </div>
          <footer className="card-foot muted small">
            {updatedAt ? `Updated ${relativeTime(new Date(updatedAt).toISOString())}` : "Loading…"} · click a row for the conversation and every PayPal call
          </footer>
        </section>
        <Funnel stats={stats} />
      </div>
    </div>
  );
}
