"use client";

import { useWorkspace } from "@/lib/workspace";

function minutes(ms: number | undefined): string {
  if (!ms) return "–";
  const m = ms / 60_000;
  return m >= 1 ? `${Math.round(m)} min` : `${Math.round(ms / 1000)} s`;
}

export default function Playbook() {
  const { config, offline } = useWorkspace();
  const p = config?.policy;
  const cap = p?.discountCapPct ?? 10;

  const steps = [
    {
      title: "Notice the walk-away",
      body: `The snippet on the checkout page sees the PayPal window close, the tab go idle or the page close. After ${config ? Math.round(config.graceMs / 1000) : 30} seconds the server asks PayPal (Orders v2) whether the order is still unpaid. Only then does it count as abandoned.`,
      tags: ["JS SDK v6", "GET /v2/checkout/orders/{id}"],
    },
    {
      title: "Reach out where they read",
      body: "If the shopper ticked the WhatsApp box at checkout, the agent sends one short message that names the item and asks what held them back. No consent, no message.",
      tags: ["WhatsApp", "opt-in only"],
    },
    {
      title: "Answer the actual objection",
      body: `Price: PayPal Pay Later (Pay in 4) first. Only if they still object, a discount of at most ${cap}% applied to the same PayPal order. "Email me": a PayPal invoice. Trust: PayPal Purchase Protection and the PayPal-hosted link. "Stop": the conversation ends for good.`,
      tags: ["Pay Later", `discount cap ${cap}%`, "Invoicing v2", "PATCH order"],
    },
    {
      title: "Count it only when PayPal says so",
      body: `A cart becomes Recovered when a verified PayPal webhook (order approved, capture completed or invoice paid) arrives. If the shopper goes quiet, one nudge after ${minutes(p?.followUpMs)}, then the agent stops.`,
      tags: ["verified webhooks", "one follow-up"],
    },
  ];

  return (
    <div className="playbook">
      <header className="page-head">
        <div>
          <h1>Playbook</h1>
          <p className="muted">What the recovery agent does, in order, and the limits it cannot cross. Values are read live from the server.</p>
        </div>
      </header>
      {offline && <p className="error banner">Can&apos;t reach the Hollaback server.</p>}

      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title} className="card step">
            <span className="step-n">{i + 1}</span>
            <div>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              <div className="tags">
                {s.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="card guard" aria-label="Guardrails">
        <header className="card-head">
          <h2>Guardrails enforced in code</h2>
        </header>
        <dl className="guard-list">
          <div>
            <dt>Largest discount</dt>
            <dd>{cap}% of the order, once, and only after Pay Later was offered when the order qualifies for it</dd>
          </div>
          <div>
            <dt>Who can be messaged</dt>
            <dd>Only shoppers who opted in at checkout; STOP ends it</dd>
          </div>
          <div>
            <dt>Money-moving PayPal calls</dt>
            <dd>Through Hollaback&apos;s checked tools, never raw from the model</dd>
          </div>
          <div>
            <dt>PayPal Agent Toolkit tools</dt>
            <dd>{p?.toolkit?.length ? p.toolkit.join(", ") : "read-only order and invoice lookups"}</dd>
          </div>
          <div>
            <dt>Webhook signatures</dt>
            <dd>{p ? (p.webhookVerified ? "Verified with PayPal on every event" : "Simulated (mock mode)") : "–"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
