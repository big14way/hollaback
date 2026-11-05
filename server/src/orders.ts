import type { Config } from "./config.js";
import { discountedTotal } from "./agent/guardrails.js";
import { money, payerActionUrl, type PayPalClient } from "./paypal/client.js";
import type { CreateOrderRequest } from "./paypal/types.js";
import type { Cart, CartItem, Store } from "./store/types.js";
import { round2 } from "./util.js";

export function itemsTotal(items: CartItem[]): number {
  return round2(items.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
}

/** Amount the shopper pays after any agent discount. */
export function effectiveTotal(cart: Pick<Cart, "total" | "discountPct">): number {
  return cart.discountPct > 0 ? discountedTotal(cart.total, cart.discountPct) : cart.total;
}

/** Orders v2 create body with a PAY_NOW experience context and a payer-action link. */
export function buildOrderRequest(cart: Cart, config: Config): CreateOrderRequest {
  const itemTotal = itemsTotal(cart.items);
  const pay = effectiveTotal({ total: itemTotal, discountPct: cart.discountPct });
  const discount = round2(itemTotal - pay);
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: cart.id,
        custom_id: cart.id,
        description: `${config.merchant.name} order`,
        amount: {
          ...money(pay, cart.currency),
          breakdown: {
            item_total: money(itemTotal, cart.currency),
            ...(discount > 0 ? { discount: money(discount, cart.currency) } : {}),
          },
        },
        items: cart.items.map((i) => ({
          name: i.name.slice(0, 127),
          quantity: String(i.quantity),
          unit_amount: money(i.unitPrice, cart.currency),
          category: "PHYSICAL_GOODS" as const,
          ...(i.sku ? { sku: i.sku.slice(0, 127) } : {}),
        })),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          return_url: `${config.demoStoreUrl}/return.html`,
          cancel_url: `${config.demoStoreUrl}/cancel.html`,
          user_action: "PAY_NOW",
          brand_name: config.merchant.name.slice(0, 127),
          shipping_preference: "NO_SHIPPING",
        },
      },
    },
  };
}

/** Create a PayPal order for the cart and store its id, status and payer-action link. */
export async function createOrderForCart(
  deps: { store: Store; paypal: PayPalClient; config: Config },
  cart: Cart,
): Promise<Cart> {
  const order = await deps.paypal.createOrder(buildOrderRequest(cart, deps.config), `hb-${cart.id}-${Date.now()}`);
  return deps.store.updateCart(cart.id, {
    paypalOrderId: order.id,
    orderStatus: order.status,
    payerActionUrl: payerActionUrl(order),
    orderCreatedAt: new Date().toISOString(),
  });
}
