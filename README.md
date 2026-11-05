# Hollaback

**One script tag that brings abandoned PayPal checkouts back.**

Most shoppers who start a checkout never finish it. Hollaback watches a merchant's PayPal checkout, notices when a shopper walks away, and messages them on WhatsApp within a minute. An AI agent that already knows their cart answers the objection and sends a one-tap way to finish: the PayPal checkout link, a PayPal Pay Later offer, or a PayPal invoice. The merchant dashboard (AG Grid) shows every abandoned cart, the agent's conversation and tool calls, and recovered revenue ticking up.

```html
<script src="https://<your-hollaback-server>/hb.js" data-merchant="demo" async></script>
```

## The problem

- Around 7 in 10 online checkouts are abandoned. For a PayPal merchant every one of them is a PayPal order that was created and never approved.
- PayPal has no "order abandoned" webhook, so merchants never find out who left or why.
- The usual fix, a reminder email hours later, reaches a shopper who has already moved on. A message within a minute, on the app they actually read, that can answer "it's a bit pricey" with "split it in 4 with Pay Later", lands while they still want the item.

## What it does

1. **Detects abandonment.** The snippet finds the checkout (PayPal buttons, checkout URL, contact fields), captures phone, email and cart, adds a WhatsApp consent checkbox, and reports `checkout_started`, `order_created` and `abandoned` (PayPal popup cancelled, 45 s idle after the order exists, tab hidden 20 s, exit intent).
2. **Confirms it with PayPal.** When an order is created the server starts a 30 s grace timer, then polls `GET /v2/checkout/orders/{id}`. It fires `abandoned` only if the order is still `CREATED` or `PAYER_ACTION_REQUIRED` and the browser signalled abandonment (or the order sat unpaid for 10 minutes). A shopper still typing their PayPal password is never messaged.
3. **Reaches out.** If the shopper opted in, a Claude agent writes to them on WhatsApp (Twilio) with their name, item and total.
4. **Handles the objection with PayPal tools.** Price: offer PayPal Pay Later first, then (only then) a discount capped at 10 % that PATCHes the order. Trust: explain PayPal Purchase Protection and send the PayPal-hosted link. "Just email me": create and send a PayPal invoice. "Stop": end and mark declined.
5. **Marks the recovery.** Verified PayPal webhooks (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `INVOICING.INVOICE.PAID`) flip the cart to Recovered with the amount, and the dashboard counter ticks up.

## Try it in 90 seconds (no accounts needed)

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

## Run it against the PayPal sandbox

1. Create a REST app at https://developer.paypal.com/dashboard (Apps & Credentials, Sandbox). Note the client id and secret, and the sandbox personal account under Testing Tools > Sandbox accounts.
2. `cp .env.example .env` and set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. `pnpm paypal:smoke` creates an order (`POST /v2/checkout/orders`) and fetches it (`GET /v2/checkout/orders/{id}`), printing the payer-action link.
4. Expose the server over HTTPS (deploy it, or run a tunnel) and set `SERVER_PUBLIC_URL`. Then `pnpm paypal:webhook` registers `POST /v1/notifications/webhooks` for the four events and prints `PAYPAL_WEBHOOK_ID`. Put it in `.env`.
5. `pnpm dev`. The demo store now renders the real JS SDK v6 PayPal and Pay Later buttons and the Pay Later message. Log in with the sandbox personal account to pay, or close the popup to trigger a recovery.
6. To exercise the webhook path without a purchase: `POST /v1/notifications/simulate-event` with your `webhook_id` and `event_type: CHECKOUT.ORDER.APPROVED`.

Sandbox buyer login and the hosted demo URL will be listed here with the deployment.

### WhatsApp (Twilio sandbox)

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_FROM` (the sandbox number, `whatsapp:+14155238886`). The shopper's phone must join the Twilio WhatsApp sandbox once by sending its join code. In the Twilio console set "When a message comes in" to `https://<server>/whatsapp/inbound` (POST). Inbound requests are checked against `X-Twilio-Signature`. Without Twilio, messages print in the server console and replies come from the dashboard.

### Claude agent

Set `ANTHROPIC_API_KEY`. The agent runs `claude-sonnet-5-5` through the Vercel AI SDK. Without a key the scripted agent runs the same policy with the same tools, so every flow works offline.

### Supabase

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and run `supabase/schema.sql` in the SQL editor. Without them an in-memory store with the same interface is used.

## Deploy to Render (free tier)

[`render.yaml`](render.yaml) is a Render Blueprint for three free services: the API server (web service) and the dashboard and demo store (static sites). Every secret is optional. With none set the hosted server runs in mock mode, exactly like `pnpm dev:mock`.

1. In the Render dashboard choose **New > Blueprint** and select this repository. Leave unknown secrets empty.
2. When the server is live, copy its `https://...onrender.com` URL. Set it as `NEXT_PUBLIC_HOLLABACK_API_URL` on the dashboard site and `HOLLABACK_API_URL` on the demo store site, then redeploy both. These values are baked in at build time.
3. On the server, set `DEMO_STORE_URL` and `DASHBOARD_URL` to the two static site URLs. The server finds its own public URL from Render's `RENDER_EXTERNAL_URL`.
4. With PayPal credentials set, register the webhook once: `pnpm paypal:webhook https://<server>.onrender.com/webhooks/paypal`, then set `PAYPAL_WEBHOOK_ID` on the server.

The free web service sleeps after 15 idle minutes and the first request after that takes about a minute. To keep it awake, set the repository variable `HOLLABACK_SERVER_URL` to the server URL and the `keep-warm` GitHub Actions workflow pings `/health` every 10 minutes. The in-memory store resets when the service restarts, so set the Supabase variables for data that persists.

## PayPal products used

| Product | Where | Calls |
| --- | --- | --- |
| **JS SDK v6** | `demo-store/` | `window.paypal.createInstance({ clientId, components: ["paypal-payments", "paypal-messages"], pageType: "checkout" })`, `findEligibleMethods({ currencyCode })`, `isEligible("paypal" \| "paylater")`, `getDetails("paylater")`, `createPayPalOneTimePaymentSession`, `createPayLaterOneTimePaymentSession`, `session.start({ presentationMode: "auto" }, createOrder())`, `onApprove` / `onCancel` / `onError` |
| **Pay Later** | demo store, agent | `<paypal-pay-later-button>`, `<paypal-message auto-bootstrap>` with `createPayPalMessages`, Pay in 4 offer from the agent |
| **Orders v2** | `server/src/paypal/client.ts` | `POST /v1/oauth2/token`, `POST /v2/checkout/orders` (`user_action: PAY_NOW`, `payer-action` link), `GET /v2/checkout/orders/{id}` (abandonment check), `PATCH /v2/checkout/orders/{id}` (capped discount), `POST /v2/checkout/orders/{id}/capture` |
| **Invoicing v2** | agent tool `create_and_send_invoice` | `POST /v2/invoicing/invoices`, `POST /v2/invoicing/invoices/{id}/send`, `GET /v2/invoicing/invoices/{id}` (`detail.metadata.recipient_view_url` is sent to the shopper) |
| **Webhooks** | `server/src/routes/webhooks.ts`, `scripts/register-webhook.ts` | `POST /v1/notifications/webhooks`, `POST /v1/notifications/verify-webhook-signature` (raw body embedded verbatim), `POST /v1/notifications/simulate-event`; events `CHECKOUT.ORDER.APPROVED`, `CHECKOUT.ORDER.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED`, `INVOICING.INVOICE.PAID` |
| **PayPal Agent Toolkit** | `server/src/agent/toolkit.ts` | `@paypal/agent-toolkit/ai-sdk` tools `get_order`, `get_invoice`, `send_invoice_reminder`, `generate_invoice_qr_code` registered next to Hollaback's tools; `get_order` runs through the toolkit when credentials are set |

## AI tools used

- **Claude (`claude-sonnet-5-5`) via the Vercel AI SDK** (`ai` v5, `@ai-sdk/anthropic`). The recovery agent: it reads the conversation, picks tools, and writes short WhatsApp replies. `server/src/agent/llm.ts`.
- **PayPal Agent Toolkit** (`@paypal/agent-toolkit/ai-sdk`). The agent reads orders and invoices through PayPal's own toolkit. The toolkit builds AI SDK v4-style tools (`parameters`), so Hollaback re-wraps each one with AI SDK v5's `dynamicTool`.
- **Agent tools** (`server/src/agent/tools.ts`), each logged to the transcript with input, output and timing:

| Tool | PayPal call | Guardrail |
| --- | --- | --- |
| `send_checkout_link` | `GET` order, re-create if `VOIDED` | link appended by the server, never typed by the model |
| `offer_pay_later` | Pay in 4 amount + checkout link | only when eligible (US, $30 to $1,500, SDK eligibility) |
| `create_and_send_invoice` | Invoicing v2 create, send, get | needs a valid email; one invoice per cart |
| `apply_discount` | `PATCH /v2/checkout/orders/{id}` | hard cap 10 %, once per order, only after Pay Later was offered, only while the order is patchable |
| `end_conversation` | none | marks declined or no reply |
| `get_order` | Orders v2 or Agent Toolkit `get_order` | read only |

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
  DB[("Supabase<br/>or in-memory")]
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
  dashboard/    Next.js 15 static export + ag-grid-react / ag-grid-community 36: carts grid, transcript page
  demo-store/   static checkout page using the PayPal JS SDK v6
  scripts/      paypal-smoke.ts, register-webhook.ts, demo-mock.ts
  supabase/     schema.sql
```

The dashboard groups carts by outcome with full-width group rows, because AG Grid's built-in row grouping is an Enterprise feature and Hollaback uses only AG Grid Community.

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

Tests (Vitest and node:test) cover the checkout detection heuristics and trigger state machine, the grace timer against the PayPal mock (cancel, approve within grace, still in popup, timeout, voided, late cancel, idle), the discount cap and other guardrails, webhook signature request building, Twilio signatures, the outcome grouping, and the full recovery loop through the HTTP API (link, Pay Later, discount, invoice, opt-out, no consent, paid normally).

## Configuration

Every variable is listed with a comment in [`.env.example`](.env.example). Nothing is required for mock mode.

## Licence

[MIT](LICENSE)
