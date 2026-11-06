"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCart, replyAsShopper, API_URL } from "@/lib/api";
import { useLiveUpdates } from "@/lib/live";
import { itemsSummary, maskPhone, money, OUTCOME_LABEL, outcomeKey, STATUS_LABEL } from "@/lib/format";

const LEFT_VIA: Record<string, string> = {
  cancel: "Closed the PayPal window",
  idle: "Went idle",
  hidden: "Left the tab",
  exit_intent: "Exit intent",
  pagehide: "Closed the page",
  timeout: "Never paid",
};
import type { CartDetail, Message, ToolCallLog } from "@/lib/types";
import { OutcomeBadge, StatusBadge } from "./Badge";

const QUICK_REPLIES = ["bit pricey rn", "still too much tbh", "just email me the invoice", "is this legit?", "ok send the link", "STOP"];

type TimelineEntry =
  | { kind: "event"; at: string; title: string; detail?: string }
  | { kind: "tool"; at: string; call: ToolCallLog }
  | { kind: "webhook"; at: string; title: string; verified: boolean; resource: string | null };

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Transcript({ id }: { id: string }) {
  const [data, setData] = useState<CartDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchCart(id));
      setError(null);
    } catch {
      setError(`Can't load this cart from ${API_URL}.`);
    }
  }, [id]);

  useLiveUpdates(load, { cartId: id, fallbackMs: 5_000 });

  useEffect(() => {
    load();
  }, [load]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await replyAsShopper(id, text.trim());
      setDraft("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const messages: Message[] = useMemo(() => data?.conversations.flatMap((c) => c.messages) ?? [], [data]);

  const timeline: TimelineEntry[] = useMemo(() => {
    if (!data) return [];
    const entries: TimelineEntry[] = [
      ...data.events.map((e) => ({
        kind: "event" as const,
        at: e.createdAt,
        title: e.type.charAt(0).toUpperCase() + e.type.slice(1).replace(/_/g, " "),
        detail:
          [e.detail.reason, e.detail.orderId, e.detail.orderStatus ? `order still ${String(e.detail.orderStatus)}` : null, e.detail.source]
            .filter(Boolean)
            .join(" · ") || undefined,
      })),
      ...messages.filter((m) => m.toolCall).map((m) => ({ kind: "tool" as const, at: m.createdAt, call: m.toolCall! })),
      ...data.webhooks.map((w) => ({
        kind: "webhook" as const,
        at: w.receivedAt,
        title: w.eventType,
        verified: w.verified,
        resource: w.resourceId,
      })),
    ];
    return entries.sort((a, b) => a.at.localeCompare(b.at));
  }, [data, messages]);

  if (!data) {
    return (
      <div className="transcript-page">
        <Link href="/" className="back">
          ← Recoveries
        </Link>
        <p className="muted">{error ?? "Loading…"}</p>
      </div>
    );
  }

  const { cart } = data;
  const latest = data.conversations[data.conversations.length - 1];
  const outcome = outcomeKey({ status: cart.status, outcome: latest?.outcome ?? (cart.status === "paid" ? "paid" : null) });
  // The demo shopper's number stays on the console channel even when the server's channel is WhatsApp.
  const openConversation = data.conversations.filter((c) => c.status === "open").at(-1);
  const canReply = openConversation?.channel === "console";

  return (
    <div className="transcript-page">
      <Link href="/" className="back">
        ← Recoveries
      </Link>
      <header className="cart-head">
        <div>
          <h1>{cart.shopperName ?? "Anonymous shopper"}</h1>
          <p className="muted">
            {[maskPhone(cart.shopperPhone), cart.shopperEmail, itemsSummary(cart.items)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="head-badges">
          {STATUS_LABEL[cart.status] !== OUTCOME_LABEL[outcome] && <StatusBadge status={cart.status} />}
          <OutcomeBadge outcome={outcome} />
          <span className="amount">{money(cart.effectiveTotal, cart.currency)}</span>
        </div>
      </header>
      <dl className="facts">
        <div>
          <dt>PayPal order</dt>
          <dd>{cart.paypalOrderId ?? "none"} {cart.orderStatus ? `(${cart.orderStatus})` : ""}</dd>
        </div>
        <div>
          <dt>How they left</dt>
          <dd>{cart.abandonReason ? (LEFT_VIA[cart.abandonReason] ?? cart.abandonReason) : "none"}</dd>
        </div>
        <div>
          <dt>Recovered</dt>
          <dd>{cart.recoveredAmount ? money(cart.recoveredAmount, cart.currency) : "not yet"}</dd>
        </div>
        <div>
          <dt>Invoice</dt>
          <dd>{cart.invoiceUrl ? <a href={cart.invoiceUrl} target="_blank" rel="noreferrer">{cart.invoiceId}</a> : "none"}</dd>
        </div>
      </dl>

      <div className="transcript-grid">
        <section className="panel chat" aria-label="Conversation">
          <h2>Conversation {data.conversations[0] ? `· ${data.conversations[0].channel === "whatsapp" ? "WhatsApp" : "Console"}` : ""}</h2>
          {messages.length === 0 && <p className="muted">No conversation yet. The agent writes once abandonment is confirmed and the shopper opted in.</p>}
          <ol className="bubbles">
            {messages.map((m) =>
              m.toolCall ? (
                <li key={m.id} className={`tool-chip ${m.toolCall.ok ? "ok" : "fail"}`}>
                  <span className="tool-name">{m.toolCall.name}</span>
                  <span className="tool-src">{m.toolCall.source === "paypal-agent-toolkit" ? "PayPal Agent Toolkit" : "Hollaback"}</span>
                  <span>{m.toolCall.ok ? "ok" : "refused"}</span>
                </li>
              ) : (
                <li key={m.id} className={`bubble ${m.role}`}>
                  <p>{m.body}</p>
                  <time>{time(m.createdAt)}</time>
                </li>
              ),
            )}
          </ol>
          {canReply && (
            <div className="reply">
              <p className="muted small">Console channel: reply as the shopper.</p>
              <div className="chips">
                {QUICK_REPLIES.map((q) => (
                  <button key={q} type="button" className="chip" disabled={sending} onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(draft);
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply…" aria-label="Shopper reply" />
                <button type="submit" disabled={sending || !draft.trim()}>
                  Send
                </button>
              </form>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>

        <section className="panel" aria-label="Timeline">
          <h2>Timeline</h2>
          <ol className="timeline">
            {timeline.map((e, i) => (
              <li key={i} className={`tl tl-${e.kind}`}>
                <time>{time(e.at)}</time>
                {e.kind === "tool" ? (
                  <details>
                    <summary>
                      <span className="tool-name">{e.call.name}</span>{" "}
                      <span className="muted">
                        {e.call.source === "paypal-agent-toolkit" ? "via PayPal Agent Toolkit" : "Hollaback tool"} · {e.call.durationMs} ms ·{" "}
                        {e.call.ok ? "ok" : "refused"}
                      </span>
                    </summary>
                    <div className="io">
                      <span className="small muted">input</span>
                      <Json value={e.call.input} />
                      <span className="small muted">output</span>
                      <Json value={e.call.output} />
                    </div>
                  </details>
                ) : e.kind === "webhook" ? (
                  <span>
                    <strong>PayPal webhook</strong> {e.title} <span className="muted">{e.verified ? "· verified" : "· unverified"}</span>
                  </span>
                ) : (
                  <span>
                    <strong>{e.title}</strong> {e.detail && <span className="muted">· {e.detail}</span>}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
