# Hollaback

**Abandoned PayPal checkouts, won back on WhatsApp.**

A merchant adds one script tag to a PayPal checkout. When a shopper opens PayPal and walks away, Hollaback checks with PayPal that the order is still unpaid, then an AI agent messages the shopper on WhatsApp within a minute, answers why they stopped, and sends a PayPal way to finish: Pay Later, a capped discount on the same order, a PayPal invoice, or the checkout link. A cart counts as recovered only when PayPal confirms the payment.

**[Try the live demo](#try-the-hosted-demo-in-two-minutes)** · [Demo store](https://hollaback-demo-store.onrender.com) · [Merchant dashboard](https://hollaback-dashboard.onrender.com) · [Sources for every number](docs/sources.md) · MIT licence

<table>
  <tr>
    <td width="68%"><img src="docs/img/dashboard.png" alt="Hollaback dashboard: recovered revenue, abandoned checkouts grouped by outcome in AG Grid, and the recovery funnel"></td>
    <td width="32%"><img src="docs/img/whatsapp.png" alt="The shopper's WhatsApp: the agent answers 'bit pricey' with PayPal Pay in 4 and a PayPal link"></td>
  </tr>
</table>

```html
<script src="https://<your-hollaback-server>/hb.js" data-merchant="demo" async></script>
```

## Why

> "I have just put off all my campaigns that's doing amazingly well"

That is a seller in Nigeria, writing on X in October 2026 about buyers who reach payment and leave. Her ads were working; the money wasn't arriving, so she switched them off. Another seller counted five abandoned payments in a day and asked why anyone changes their mind at the last step. Others chase those buyers by hand, one message at a time.

- About **70%** of online carts are abandoned (Baymard Institute).
- The usual fix, a reminder email, turns about **1.5%** of sends into sales (Omnisend).
- Where Pay Later is offered, Pay Later messaging and buttons lift PayPal sales by **29%** (PayPal).

PayPal tells a merchant when an order is approved, not when a shopper walks away, so these buyers are usually never followed up at all. Every figure and quote is linked in [`docs/sources.md`](docs/sources.md).

## How it works

1. **Notices the walk-away.** The snippet finds the checkout (PayPal buttons, checkout URL, contact fields), captures phone, email and cart, adds a WhatsApp consent checkbox, and reports `checkout_started`, `order_created` and `abandoned` (PayPal popup cancelled, 45 s idle after the order exists, tab hidden 20 s, exit intent).
2. **Checks with PayPal.** After a 30 s grace period the server calls `GET /v2/checkout/orders/{id}`. It treats the cart as abandoned only if the order is still `CREATED` or `PAYER_ACTION_REQUIRED` and the browser signalled abandonment (or the order sat unpaid for 10 minutes). A shopper still typing their PayPal password is never messaged.
3. **Reaches out where they read.** If the shopper opted in, a Claude agent writes on WhatsApp (Twilio) with their name, item and total.
4. **Answers the actual objection.** Price: PayPal Pay Later first, then (only then) a discount capped at 10% that PATCHes the same PayPal order. "Just email me": a PayPal invoice, created and sent through the PayPal Agent Toolkit. Trust: PayPal Purchase Protection and the PayPal-hosted link. "No thanks": the conversation ends for good.
5. **Counts it only when PayPal says so.** Verified PayPal webhooks (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `INVOICING.INVOICE.PAID`) flip the cart to Recovered, live on the dashboard.

## What makes it different

- **It asks PayPal before it says anything,** so nobody who already paid gets a reminder.
- **It answers the reason, with PayPal's own tools,** instead of sending a coupon to everyone: Pay in 4 for price, a PayPal invoice for "email me", the same PayPal order for a capped discount.
- **The guardrails are code, not prompt.** The model never calls a money-moving PayPal endpoint directly; it goes through Hollaback's checked tools (discount cap, one invoice per cart, consent required, opt-out honoured).
- **One script tag.** No checkout rebuild; it reads the page the merchant already has.

## Try the hosted demo in two minutes

No WhatsApp or accounts needed.

1. Open the [demo store](https://hollaback-demo-store.onrender.com) and click *Fill in a demo shopper* (it also ticks the WhatsApp consent box).
2. Click *Pay with PayPal* or *Pay Later*, then close the PayPal window without paying.
3. About 30 seconds later the cart appears on the [dashboard](https://hollaback-dashboard.onrender.com). Open it: the agent has written to the shopper. Reply with the chips, for example `bit pricey rn` (Pay Later) or `just email me the invoice` (a real PayPal sandbox invoice, created through the PayPal Agent Toolkit).
4. Open the PayPal link or invoice the agent sent, log in as the sandbox buyer below and pay. The cart flips to Recovered within seconds of PayPal's webhook.

| Sandbox buyer (US test account, sandbox money only) | |
| --- | --- |
| Email | `sb-0nvk853708082@personal.example.com` |
| Password | `lyl$I7Pi` |

Skip *Pay with Debit or Credit Card* on the PayPal page; that is guest checkout. Log in with the account above to see PayPal Pay Later.

*Fill in a demo shopper* uses a made-up number, so its conversation runs on that cart's dashboard page. To get the messages on your own WhatsApp instead, first send `join tales-told` to +1 415 523 8886 on WhatsApp, then check out with your own number.

The server runs on Render's free tier, so the very first request after an idle spell can take about a minute. Its API is at https://hollaback-server.onrender.com/health.

## Screens

| | |
| --- | --- |
| <img src="docs/img/checkout.png" alt="Kicks Lagos checkout with PayPal and Pay Later buttons and the WhatsApp consent box"> | <img src="docs/img/conversation.png" alt="A recovered cart: the WhatsApp conversation, the invoice created via the PayPal Agent Toolkit, and the verified INVOICING.INVOICE.PAID webhook"> |
| The demo store: a PayPal JS SDK v6 checkout with the Hollaback snippet | Every conversation with each tool call, PayPal's response and the verified webhook |
| <img src="docs/img/playbook.png" alt="The Playbook page: the agent's four steps and the guardrails enforced in code"> | <img src="docs/img/dashboard.png" alt="Recoveries grid grouped by outcome with pinned totals and CSV export"> |
| The Playbook: what the agent does and the limits it cannot cross, read live from the server | Recoveries in AG Grid: grouped by outcome, quick filter, pinned totals, CSV export |

## Tested end to end

On Nov 5 and 6 2026, eight carts were recovered from a real phone on PayPal sandbox, each confirmed by a verified PayPal webhook: four through the PayPal link the agent sent (Pay in 4 on camera) and four through PayPal invoices, the latest created through the PayPal Agent Toolkit. Declines and no-replies were exercised too. `pnpm check` runs about 100 automated tests; see [Scripts](#scripts).

## Run it yourself

### In 90 seconds, with no accounts

Requirements: Node 20+ and pnpm 10 (`corepack enable`).

```bash
git clone https://github.com/big14way/hollaback.git && cd hollaback
pnpm i
pnpm dev:mock        # server :4000, dashboard :3000, demo store :5173
```

In a second terminal:

```bash
pnpm demo:mock
```

`demo:mock` walks one cart through the whole loop against the running server and prints each step:

```
1. Shopper opens the Kicks Lagos checkout
2. Shopper clicks the PayPal button          PayPal order KZ8WTJEEXVV95EJS8 (PAYER_ACTION_REQUIRED)
3. Shopper closes the PayPal popup without paying
4. Server confirms abandonment after the 30s grace period
5. Agent  > Hi Ada, this is Kicks Lagos. Saw you were about to grab the Air Runners ($89.00). Anything holding you back?
6. Shopper> bit pricey rn
   Agent  > No stress. You can split it into 4 interest-free payments with PayPal Pay Later: $22.25 today ...
            http://localhost:4000/mock/paypal/checkoutnow?token=KZ8WTJEEXVV95EJS8
7. Shopper taps the link and approves on PayPal   (CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED)
8. Recovered: $89.00
PASS: created -> abandoned -> agent message -> recovered
```

Then open:

- **Dashboard** at http://localhost:3000: the cart sits in the Recovered group and the recovered revenue counter has ticked up. Click the row for the transcript and the tool-call timeline (inputs, outputs, timings, webhooks).
- **Demo store** at http://localhost:5173: click *Fill in a demo shopper* (it also ticks the consent box), click *Pay with PayPal*, then close the PayPal window. About 30 s later the agent's WhatsApp message prints in the `pnpm dev:mock` terminal and a new row appears on the dashboard without a refresh (it subscribes to the server's live event stream). On that cart's page, use the *reply as shopper* chips: `bit pricey rn` (Pay Later), `still too much tbh` (10 % discount), `just email me the invoice` (PayPal invoice), `STOP` (opt-out). Open the link the agent sent and approve to watch the row flip to Recovered.

Mock mode replaces PayPal with an in-process fake of the Orders v2, Invoicing v2 and Webhooks endpoints. It is plugged in as the `fetch` of the real PayPal client, so the same request-building code runs in mock mode and in the sandbox. Its approval and invoice pages are clearly labelled as simulated.

### Against the PayPal sandbox

1. Create a REST app at https://developer.paypal.com/dashboard (Apps & Credentials, Sandbox). Note the client id and secret, and the sandbox personal account under Testing Tools > Sandbox accounts.
2. `cp .env.example .env` and set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. `pnpm paypal:smoke` creates an order (`POST /v2/checkout/orders`) and fetches it (`GET /v2/checkout/orders/{id}`), printing the payer-action link.
4. Expose the server over HTTPS (deploy it, or run a tunnel) and set `SERVER_PUBLIC_URL`. Then `pnpm paypal:webhook` registers `POST /v1/notifications/webhooks` for the four events and prints `PAYPAL_WEBHOOK_ID`. Put it in `.env`.
5. `pnpm dev`. The demo store now renders the real JS SDK v6 PayPal and Pay Later buttons and the Pay Later message. Log in with the sandbox personal account to pay, or close the popup to trigger a recovery.

   PayPal decides Pay Later eligibility from the buyer's country. So that testers outside the US see the Pay Later button and the agent's Pay Later offer, the demo store passes the sandbox-only `testBuyerCountry: "US"` to `createInstance`. Add `?buyerCountry=auto` to the store URL to use your real location instead, or `?buyerCountry=GB` (any two-letter code) to try another country. Paying with Pay Later needs a US sandbox personal account.
6. To exercise the webhook path without a purchase: `POST /v1/notifications/simulate-event` with your `webhook_id` and `event_type: CHECKOUT.ORDER.APPROVED`.

Use your own sandbox personal account to pay locally, or the hosted demo's sandbox buyer listed under [Try the hosted demo](#try-the-hosted-demo-in-two-minutes).

#### WhatsApp (Twilio sandbox)

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_FROM` (the sandbox number, `whatsapp:+14155238886`). The shopper's phone must join the Twilio WhatsApp sandbox once by sending its join code. In the Twilio console set "When a message comes in" to `https://<server>/whatsapp/inbound` (POST). Inbound requests are checked against `X-Twilio-Signature`. Without Twilio, messages print in the server console and replies come from the dashboard.

The channel is picked per conversation. Numbers in `CONSOLE_NUMBERS` (by default the demo store's *Fill in a demo shopper* number, +234 803 123 4567, which never joined the sandbox) stay on the console channel even when WhatsApp is on, so their conversation runs in the dashboard's *reply as shopper* box. Every other number gets WhatsApp. To get the hosted demo's conversation on your own phone, send `join tales-told` to +1 415 523 8886 on WhatsApp first, then check out with your own number.

On the Twilio sandbox, `STOP` is Twilio's own keyword: it removes your phone from the sandbox and never reaches Hollaback (the next message fails with error 63015 until you send the join code again). To see the decline path there, reply something like `no thanks, not interested`. With a production WhatsApp sender, `STOP` reaches Hollaback and ends the conversation for good.

#### Claude agent

Set `ANTHROPIC_API_KEY`. The agent runs `claude-haiku-5-5` (Claude Haiku 5.5) through the Vercel AI SDK, at effort `medium` (`AGENT_EFFORT`). Without a key the scripted agent runs the same policy with the same tools, so every flow works offline.

#### Persistence

By default carts and conversations live in memory and are gone after a restart. Two ways to keep them:

- **Postgres snapshot** (simplest, works with a free Neon database): set `DATABASE_URL`. On boot the server loads the latest snapshot, and about a second after each write it saves the whole store as one jsonb row in `hollaback_snapshot` (created if missing; one row per server URL). If the database can't be reached at boot, the server logs a warning, starts empty and doesn't save that run, so the saved data is never overwritten. `/health` reports `"store": "memory+postgres"` while it is on.
- **Supabase**: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and run `supabase/schema.sql` in the SQL editor. It takes precedence over `DATABASE_URL`.

### Deploy to Render (free tier)

[`render.yaml`](render.yaml) is a Render Blueprint for three free services: the API server (web service) and the dashboard and demo store (static sites). Every secret is optional. With none set the hosted server runs in mock mode, exactly like `pnpm dev:mock`.

1. In the Render dashboard choose **New > Blueprint** and select this repository. Leave unknown secrets empty.
2. When the server is live, copy its `https://...onrender.com` URL. Set it as `NEXT_PUBLIC_HOLLABACK_API_URL` on the dashboard site and `HOLLABACK_API_URL` on the demo store site, then redeploy both. These values are baked in at build time.
3. On the server, set `DEMO_STORE_URL` and `DASHBOARD_URL` to the two static site URLs. The server finds its own public URL from Render's `RENDER_EXTERNAL_URL`.
4. With PayPal credentials set, register the webhook once: `pnpm paypal:webhook https://<server>.onrender.com/webhooks/paypal`, then set `PAYPAL_WEBHOOK_ID` on the server.

The free web service sleeps after 15 idle minutes and the first request after that takes about a minute. To keep it awake, set the repository variable `HOLLABACK_SERVER_URL` to the server URL and the `keep-warm` GitHub Actions workflow pings `/health` every 10 minutes (optionally from the date in `HOLLABACK_WARM_FROM`, to save free hours). The in-memory store resets when the service restarts or sleeps, so set `DATABASE_URL` to a free Neon Postgres database to keep the demo data (see [Persistence](#persistence)).

## PayPal products used

| Product | Where | Calls |
| --- | --- | --- |
| **JS SDK v6** | `demo-store/` | `window.paypal.createInstance({ clientId, components: ["paypal-payments", "paypal-messages"], pageType: "checkout", testBuyerCountry })`, `findEligibleMethods({ currencyCode, amount })`, `isEligible("paypal" \| "paylater")`, `getDetails("paylater")`, `createPayPalOneTimePaymentSession`, `createPayLaterOneTimePaymentSession`, `session.start({ presentationMode: "auto" }, createOrder())`, `onApprove` / `onCancel` / `onError` |
| **Pay Later** | demo store, agent | `<paypal-pay-later-button>`, `<paypal-message auto-bootstrap>` with `createPayPalMessages`, Pay in 4 offer from the agent |
| **Orders v2** | `server/src/paypal/client.ts` | `POST /v1/oauth2/token`, `POST /v2/checkout/orders` (`user_action: PAY_NOW`, `payer-action` link), `GET /v2/checkout/orders/{id}` (abandonment check), `PATCH /v2/checkout/orders/{id}` (capped discount), `POST /v2/checkout/orders/{id}/capture` |
| **Invoicing v2** | agent tools `create_and_send_invoice`, `send_invoice_reminder` | `POST /v2/invoicing/invoices`, `POST /v2/invoicing/invoices/{id}/send`, `GET /v2/invoicing/invoices/{id}` (`detail.metadata.recipient_view_url` is sent to the shopper), `POST /v2/invoicing/invoices/{id}/remind`; through the Agent Toolkit when credentials are set |
| **Webhooks** | `server/src/routes/webhooks.ts`, `scripts/register-webhook.ts` | `POST /v1/notifications/webhooks`, `POST /v1/notifications/verify-webhook-signature` (raw body embedded verbatim), `POST /v1/notifications/simulate-event`; events `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED`, `INVOICING.INVOICE.PAID` |
| **PayPal Agent Toolkit** | `server/src/agent/toolkit.ts`, `server/src/agent/invoicing.ts` | `@paypal/agent-toolkit/ai-sdk` tools. Inside Hollaback's guarded tools: `create_invoice`, `send_invoice` and `get_invoice` (`create_and_send_invoice`), `get_order` (`get_order`), `send_invoice_reminder` (the cart's own invoice only, also the 15-minute follow-up). Given to the model as they are: `get_invoice` and `generate_invoice_qr_code`, limited to the cart's invoice. Mock mode uses the REST client instead, which is also the fallback when a toolkit call fails |

## The agent, its tools and its guardrails

- **Claude Haiku 5.5 (`claude-haiku-5-5`) via the Vercel AI SDK** (`ai` v5, `@ai-sdk/anthropic`). The recovery agent: it reads the conversation, picks tools, and writes short WhatsApp replies. `server/src/agent/llm.ts`.
- **PayPal Agent Toolkit** (`@paypal/agent-toolkit/ai-sdk`). With PayPal credentials set, the agent creates and sends invoices, sends invoice reminders and checks order status through PayPal's own toolkit, and the dashboard marks those calls "via PayPal Agent Toolkit". Every input is checked against the toolkit's own schemas first. The toolkit builds AI SDK v4-style tools (`parameters`), so the ones the model calls directly are re-wrapped with AI SDK v5's `dynamicTool`.
- **Agent tools** (`server/src/agent/tools.ts`), each logged to the transcript with input, output and timing:

| Tool | PayPal call | Guardrail |
| --- | --- | --- |
| `send_checkout_link` | `GET` order, re-create if `VOIDED` | link appended by the server, never typed by the model |
| `offer_pay_later` | Pay in 4 amount + checkout link | only when eligible (US, $30 to $1,500, SDK eligibility) |
| `create_and_send_invoice` | Agent Toolkit `create_invoice`, `send_invoice`, `get_invoice` (Invoicing v2) | needs a valid email; one invoice per cart |
| `send_invoice_reminder` | Agent Toolkit `send_invoice_reminder` (`POST .../remind`) | only the cart's own invoice (the model passes no id), only while unpaid, at most one every 10 minutes |
| `apply_discount` | `PATCH /v2/checkout/orders/{id}` | hard cap 10 %, once per order, only after Pay Later was offered, only while the order is patchable |
| `end_conversation` | none | marks declined or no reply |
| `get_order` | Agent Toolkit `get_order` (Orders v2) | read only, the cart's own order |

When the shopper has an unpaid invoice, the one follow-up after 15 minutes of silence is PayPal's own reminder for that invoice rather than the checkout link again.

Deterministic rules sit outside the model (`server/src/agent/guardrails.ts`): opt-out words (`STOP`, `no`, `unsubscribe` and others) end the chat before the model is called, two unanswered messages end the chat, the discount rules above, and no message is sent without WhatsApp consent.

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Merchant checkout page"]
    SDK["PayPal JS SDK v6<br/>PayPal + Pay Later buttons<br/>Pay Later message"]
    HB["hb.js snippet (8 KB)<br/>cart, phone, email, consent<br/>cancel / idle / hidden / exit intent"]
  end
  subgraph Server["Hollaback server (Fastify, Node 20)"]
    Orders["/orders"]
    Events["/events"]
    Monitor["Abandonment monitor<br/>30s grace, polls order status"]
    Agent["Recovery agent<br/>Claude via Vercel AI SDK<br/>+ PayPal Agent Toolkit"]
    Hooks["/webhooks/paypal<br/>signature verified"]
    API["/api/carts"]
  end
  PayPal[("PayPal<br/>Orders v2, Invoicing v2,<br/>Webhooks")]
  WA["WhatsApp<br/>(Twilio)"]
  DB[("In-memory + Postgres snapshot<br/>or Supabase")]
  Dash["Dashboard<br/>Next.js + AG Grid"]

  SDK -- createOrder --> Orders --> PayPal
  HB -- POST /events --> Events --> Monitor
  Monitor -- GET order --> PayPal
  Monitor -- abandoned --> Agent
  Agent <--> WA
  Agent -- tools --> PayPal
  PayPal -- webhooks --> Hooks --> DB
  Events --> DB
  Agent --> DB
  API -- "REST + live events (SSE)" --> Dash
  DB --> API
```

```
hollaback/
  snippet/      vanilla TS -> esbuild -> dist/hb.js (< 15 KB budget enforced at build)
  server/       Fastify API, PayPal client + in-process mock, abandonment monitor, agent, channels, stores
  dashboard/    Next.js 15 static export + ag-grid-react / ag-grid-community 36: recoveries grid, conversation page, Playbook
  demo-store/   static checkout page using the PayPal JS SDK v6
  scripts/      paypal-smoke.ts, register-webhook.ts, demo-mock.ts
  supabase/     schema.sql
  docs/         sources for every number, demo video config, screenshots
```

The dashboard groups carts by outcome with full-width group rows, because AG Grid's built-in row grouping is an Enterprise feature and Hollaback uses only AG Grid Community. It also uses Community's quick filter, a pinned bottom totals row (carts shown, their value and what was recovered, following the filter) and CSV export (`exportDataAsCsv` with readable values: outcome labels, ISO times, plain amounts, how each recovered cart was paid and the PayPal order id).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev:mock` | Server (mock PayPal), dashboard and demo store |
| `pnpm demo:mock` | Scripted cart: created, abandoned, agent message, recovered |
| `pnpm dev` | Same three apps using `.env` (PayPal sandbox when credentials are set) |
| `pnpm check` | Lint, typecheck and tests across all packages |
| `pnpm paypal:smoke` | Create and fetch a sandbox order |
| `pnpm paypal:webhook [url]` | Register the PayPal webhook and print its id |
| `pnpm build` | Build every package |

Tests (Vitest and node:test) cover the checkout detection heuristics and trigger state machine, the grace timer against the PayPal mock (cancel, approve within grace, still in popup, timeout, voided, late cancel, idle), the discount cap and other guardrails, webhook signature request building, Twilio signatures, the outcome grouping, the full recovery loop through the HTTP API (link, Pay Later, discount, invoice, opt-out, no consent, paid normally), the PayPal Agent Toolkit path (inputs checked against the toolkit's own schemas, REST fallback, invoice reminders scoped to the cart), and per-number channel routing.

## Configuration

Every variable is listed with a comment in [`.env.example`](.env.example). Nothing is required for mock mode.

## Licence

[MIT](LICENSE)
