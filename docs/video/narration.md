# Demo video narration

Built with the pitch-video builder from `demo.json` (slides, phone and laptop scenes) and `scenes.json` (Playwright recordings of the store and dashboard). Phone footage is the shopper's real WhatsApp, screen-recorded on Nov 5 2026 against PayPal sandbox; notification banners and the sandbox account's default business name are blurred. The dashboard overview and conversation scenes were recorded on Nov 6 against the hosted server. Every number and quote is sourced in [`../sources.md`](../sources.md).

| Scene | Kind | Seconds | On screen | Narration |
| --- | --- | --- | --- | --- |
| t0 | title | 7.7 | Abandoned PayPal checkouts, won back on WhatsApp. | Hollaback. When a shopper walks away from a PayPal checkout, an AI agent wins them back on WhatsApp, within a minute. |
| s1 | slide | 18.3 | Her ads were working. Her buyers weren't paying. | In October, a seller in Nigeria posted that her ads were doing amazingly well. Buyers clicked, got to payment, and left. So she switched the ads off. Another seller lost five payments in one day, and asked why anyone changes their mind at the last step. Seven in ten online carts end this way. |
| s2 | slide | 12.9 | Reminder emails don't bring them back | The usual fix, a reminder email, turns about one and a half percent into sales. Shoppers would rather message, and where PayPal Pay Later is offered, PayPal sales rise twenty-nine percent. |
| s3 | slide | 15.7 | One script tag. A PayPal way to finish. | Hollaback is one script tag on a PayPal checkout. It notices the walk-away and confirms with PayPal that the order is still unpaid, so nobody who paid gets nagged. Then an agent answers the real objection with a PayPal way to finish, not a coupon blast. |
| p1 | laptop | 10.2 | Kicks Lagos: a Lagos sneaker brand selling abroad | Kicks Lagos is a Lagos sneaker brand selling to customers abroad. A shopper opts in to WhatsApp updates, opens PayPal Pay Later, and closes it. |
| p2 | phone | 13.1 | Within a minute, on WhatsApp | Thirty seconds later, PayPal confirms the order is still unpaid, so the agent writes. She says it's a bit pricey. The agent checks Pay Later and offers Pay in 4: twenty-two dollars twenty-five today. |
| p3 | phone | 10.3 | She pays in 4 on PayPal | She taps the link, logs in to PayPal, picks Pay in 4 and approves. Back on WhatsApp, the thank-you is already waiting. |
| p4 | laptop | 11.0 | The merchant sees it land, live | On the merchant's dashboard, built on AG Grid, the cart flips to Recovered the moment PayPal's verified webhook lands, and recovered revenue ticks up. |
| p5 | phone | 15.0 | "Just email me the invoice" | Another shopper just wants an invoice. The agent creates and sends a PayPal invoice, shares the pay link, and when it's paid, the cart counts as recovered. |
| p6 | laptop | 11.5 | Every abandoned checkout, by outcome | Every abandoned checkout lands here, grouped by outcome, with totals pinned at the bottom. Search finds any shopper, order or invoice, and the list exports to CSV. |
| p7 | laptop | 10.9 | Every PayPal call, on the record | Each conversation keeps its receipts: every tool the agent called, including invoices created through PayPal's Agent Toolkit, and every webhook, verified with PayPal. |
| p8 | laptop | 9.3 | Guardrails live in code, not in the prompt | The model can't give the store away: discounts are capped at ten percent, once, after Pay Later, and only opted-in shoppers are messaged. |
| s9 | slide | 17.2 | PayPal does the real work | Under the hood: PayPal's JavaScript SDK version six, Orders, Pay Later, Invoicing and verified webhooks, with the PayPal Agent Toolkit creating and sending the invoices. Claude Haiku runs the agent, AG Grid powers the dashboard, and it all runs on Render. |
| s10 | slide | 12.7 | Every recovery is a sale that was already lost | Every recovery is a sale that was already lost, completed through PayPal. Merchants pay a share of what's recovered, so they only pay when it works. Eight real-phone recoveries are on record in PayPal sandbox. |
| e0 | end | 6.2 | One script tag. / Every PayPal merchant / could use it tomorrow. | Hollaback. One script tag, and every PayPal merchant could use it tomorrow. |

Total: 173.6 s after crossfades.
