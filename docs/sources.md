# Sources for the numbers and quotes in the demo video

Every figure the video states, where it comes from, and when it was checked (Nov 5 2026).

| Claim in the video | Source |
| --- | --- |
| 70.22% of online shopping carts are abandoned (average of 50 studies) | Baymard Institute, [Cart abandonment rate statistics](https://baymard.com/lists/cart-abandonment-rate) |
| $260 billion of lost orders in the US and EU are recoverable through better checkout | Baymard Institute, same page |
| Abandoned-cart emails convert 1.51% of sends (2025 data) | Omnisend, [Cart abandonment emails](https://www.omnisend.com/blog/cart-abandonment-emails/) |
| 72.4% of consumers are more likely to buy from a brand that offers messaging (Kantar for Meta, 22 markets) | Meta, [State of business messaging](https://business.whatsapp.com/resources/resource-library/state-of-business-messaging) |
| Pay Later messaging and/or the Pay Later button: +29% PayPal sales (7 markets) | PayPal, [Pay Later for business](https://www.paypal.com/us/business/accept-payments/checkout/installments) |
| PayPal Pay Later is offered to buyers in the US, UK, Canada, Australia, Germany, France, Italy and Spain | PayPal, same page (footnotes) |

## Sellers in their own words

Public posts on X by online sellers in Nigeria, quoted on screen without their names.

- "I have just put off all my campaigns that's doing amazingly well" — a seller replying that her only challenge is buyers abandoning at payment ([Oct 30 2026](https://x.com/EcomMumsy/status/2116202112099013006))
- "Forget heartbreak … I got like 5 yesterday" / "Why would someone visit my Selar link, and all of a sudden change their mind on paying?" ([Aug 13 2026](https://x.com/semmadaisy/status/2087998019928993807))
- "contact the abandoned transactions and collect payments from them manually" (Oct 1 2026, same seller as the Sep 16 post below)
- "the abandoned transaction situation is getting worrisome" ([Oct 8 2026](https://x.com/yfly58/status/2108204578436940207))
- "how do you close abandoned transactions … Emails or WhatsApp, please" ([Sep 16 2026](https://x.com/PersonalRa25/status/2100223869151801740))
- "Abandoned transactions are completely normal, but what you do after is what matters." ([Aug 6 2026](https://x.com/tryselar/status/2085320124534243767))

## The demo itself

Recorded on Nov 5 2026 against PayPal sandbox with a real phone on the Twilio WhatsApp sandbox. The merchant is a US sandbox business account (Kicks Lagos, a Lagos sneaker brand selling abroad) and the shopper pays with a US sandbox personal account, because Pay Later is offered to US buyers. Six carts were recovered end to end that evening: three through the PayPal checkout link the agent sent (the one on camera paid with Pay in 4) and three through PayPal invoices. Each was confirmed by PayPal (a verified webhook, or the server's own order check followed by the verified webhook). Two more conversations ended as a decline and a no-reply, which is why the dashboard in the video shows all four outcomes.
