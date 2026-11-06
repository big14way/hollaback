# Demo video narration

Built with the pitch-video builder from `demo.json` (slides, phone and laptop scenes) and `scenes.json` (Playwright recordings of the store and dashboard). Phone footage is the shopper's real WhatsApp, screen-recorded on Nov 5 2026 against PayPal sandbox; notification banners and the sandbox account's default business name are blurred. Every number is sourced in [`../sources.md`](../sources.md).

| Scene | Kind | Seconds | On screen | Narration |
| --- | --- | --- | --- | --- |
| t0 | title | 7.7 | Abandoned PayPal checkouts, won back on WhatsApp. | Hollaback. When a shopper walks away from a PayPal checkout, an AI agent wins them back on WhatsApp, within a minute. |
| s1 | slide | 13.8 | Sellers watch the money walk away | Online sellers in Nigeria say it plainly: the abandoned transaction situation is getting worrisome. One asks how to follow up: emails, or WhatsApp? And it isn't just them. Seven in ten online carts are abandoned. |
| s2 | slide | 16.6 | Reminder emails don't bring them back | Baymard puts recoverable lost orders at two hundred and sixty billion dollars. The usual fix, a reminder email, turns about one and a half percent into sales. Shoppers would rather message. And where PayPal Pay Later is offered, PayPal sales rise twenty-nine percent. |
| s3 | slide | 12.7 | One script tag. A PayPal way to finish. | Hollaback is one script tag on a PayPal checkout. It notices the walk-away, asks PayPal whether the order is still unpaid, and an agent answers the shopper's real objection with a PayPal way to finish. |
| p1 | laptop | 10.2 | Kicks Lagos: a Lagos sneaker brand selling abroad | Kicks Lagos is a Lagos sneaker brand selling to customers abroad. A shopper opts in to WhatsApp updates, opens PayPal Pay Later, and closes it. |
| p2 | phone | 13.1 | Within a minute, on WhatsApp | Thirty seconds later, PayPal confirms the order is still unpaid, so the agent writes. She says it's a bit pricey. The agent checks Pay Later and offers Pay in 4: twenty-two dollars twenty-five today. |
| p3 | phone | 10.3 | She pays in 4 on PayPal | She taps the link, logs in to PayPal, picks Pay in 4 and approves. Back on WhatsApp, the thank-you is already waiting. |
| p4 | laptop | 11.0 | The merchant sees it land, live | On the merchant's dashboard, built on AG Grid, the cart flips to Recovered the moment PayPal's verified webhook lands, and recovered revenue ticks up. |
| p5 | phone | 15.0 | "Just email me the invoice" | Another shopper just wants an invoice. The agent creates and sends a PayPal invoice, shares the pay link, and when it's paid, the cart counts as recovered. |
| p6 | laptop | 11.9 | Every abandoned checkout, by outcome | Every abandoned checkout lands here, grouped by outcome: recovered by link or by invoice, no reply, or declined. Search finds any shopper, order or invoice. |
| p7 | laptop | 8.9 | Every PayPal call, on the record | Each conversation keeps its receipts: every tool the agent called, what PayPal returned, and every webhook, verified with PayPal. |
| p8 | laptop | 11.9 | Guardrails live in code, not in the prompt | And the model can't give the store away. Discounts are capped at ten percent, once, only after Pay Later. Only opted-in shoppers are messaged, and money moves only through checked tools. |
| s9 | slide | 15.4 | PayPal does the real work | Under the hood: PayPal's JavaScript SDK version six, Orders, Pay Later, Invoicing, verified webhooks and the PayPal Agent Toolkit. Claude Haiku runs the agent, AG Grid powers the dashboard, and it all runs on Render. |
| s10 | slide | 13.7 | Every recovery is a sale that was already lost | Every recovery is a sale that was already lost, completed through PayPal. Merchants would pay a share of what's recovered, so they only pay when it works. Six recoveries from a real phone are already on record in PayPal sandbox. |
| e0 | end | 6.2 | One script tag. / Every PayPal merchant / could use it tomorrow. | Hollaback. One script tag, and every PayPal merchant could use it tomorrow. |

Total: 170.1 s after crossfades.
