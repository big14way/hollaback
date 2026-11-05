"use client";

import {
  AllCommunityModule,
  colorSchemeVariable,
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
import { groupByOutcome, toDataRows, type DataRow, type GridRow, type GroupHeaderRow } from "@/lib/grouping";
import type { CartRow, Stats } from "@/lib/types";
import { OutcomeBadge, StatusBadge } from "./Badge";
import { Counter } from "./Counter";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withPart(colorSchemeVariable).withParams({
  fontFamily: "inherit",
  headerFontWeight: 600,
  rowHeight: 46,
  headerHeight: 42,
  wrapperBorderRadius: 12,
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

  const rows: GridRow[] = useMemo(() => (grouped ? groupByOutcome(carts, collapsed) : toDataRows(carts)), [carts, grouped, collapsed]);

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        headerName: "Status",
        field: "status" as never,
        width: 150,
        cellRenderer: (p: ICellRendererParams<DataRow>) => (p.data ? <StatusBadge status={p.data.status} /> : null),
      },
      {
        headerName: "Shopper",
        flex: 1.2,
        minWidth: 180,
        valueGetter: (p) => (p.data?.kind === "cart" ? [p.data.shopperName, maskPhone(p.data.shopperPhone)].filter(Boolean).join(" · ") || "Anonymous" : ""),
      },
      {
        headerName: "Items",
        flex: 1.2,
        minWidth: 160,
        valueGetter: (p) => (p.data?.kind === "cart" ? itemsSummary(p.data.items) : ""),
      },
      {
        headerName: "Total",
        width: 120,
        type: "rightAligned",
        valueGetter: (p) => (p.data?.kind === "cart" ? p.data.effectiveTotal : null),
        valueFormatter: (p) => (p.data?.kind === "cart" ? money(p.value as number, p.data.currency) + (p.data.discountPct ? ` (−${p.data.discountPct}%)` : "") : ""),
      },
      {
        headerName: "Abandoned at",
        width: 140,
        valueGetter: (p) => (p.data?.kind === "cart" ? p.data.abandonedAt : null),
        valueFormatter: (p) => relativeTime(p.value as string | null),
        tooltipValueGetter: (p) => (p.value ? new Date(p.value as string).toLocaleString() : null),
        sort: undefined,
      },
      {
        headerName: "Signal",
        width: 110,
        valueGetter: (p) => (p.data?.kind === "cart" ? (p.data.abandonReason ?? "") : ""),
      },
      {
        headerName: "Channel",
        width: 120,
        valueGetter: (p) => (p.data?.kind === "cart" ? p.data.channel : null),
        valueFormatter: (p) => (p.value === "whatsapp" ? "WhatsApp" : p.value === "console" ? "Console" : ""),
      },
      {
        headerName: "Outcome",
        width: 160,
        valueGetter: (p) => (p.data?.kind === "cart" ? outcomeKey(p.data) : null),
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data?.kind === "cart" ? <OutcomeBadge outcome={outcomeKey(p.data)} /> : null,
      },
      {
        headerName: "Recovered $",
        width: 130,
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
      if (e.data?.kind === "cart") router.push(`/carts/${e.data.id}`);
    },
    [router],
  );

  const currency = stats?.currency ?? "USD";

  return (
    <div className="dashboard">
      <section className="tiles" aria-label="Recovery summary">
        <div className="tile hero">
          <span className="tile-label">Recovered revenue</span>
          <Counter value={stats?.recoveredRevenue ?? 0} currency={currency} />
        </div>
        <div className="tile">
          <span className="tile-label">Abandoned</span>
          <span className="tile-value">{stats?.abandoned ?? 0}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Agent engaged</span>
          <span className="tile-value">{stats?.contacted ?? 0}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Recovered</span>
          <span className="tile-value">{stats?.recovered ?? 0}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Recovery rate</span>
          <span className="tile-value">{Math.round((stats?.recoveryRate ?? 0) * 100)}%</span>
        </div>
      </section>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Filter carts: shopper, item, status, order id…"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          aria-label="Quick filter"
        />
        <label className="toggle">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by outcome
        </label>
        <span className="updated" aria-live="polite">
          {error ? <span className="error">{error}</span> : updatedAt ? `${live ? "Live" : "Polling"} · updated ${relativeTime(new Date(updatedAt).toISOString())}` : "Loading…"}
        </span>
      </div>

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
          overlayNoRowsTemplate="No carts yet. Open the demo store and start a PayPal checkout."
          domLayout="autoHeight"
          tooltipShowDelay={300}
        />
      </div>
    </div>
  );
}
