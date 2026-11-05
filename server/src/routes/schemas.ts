import { z } from "zod";
import type { Cart } from "../store/types.js";
import { isValidEmail, normalizePhone } from "../util.js";

export const ContactSchema = z
  .object({
    phone: z.string().max(40).nullish(),
    email: z.string().max(200).nullish(),
    name: z.string().max(120).nullish(),
  })
  .partial();

export const ItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(99),
  unitPrice: z.number().min(0.01).max(100_000),
  sku: z.string().max(127).nullish(),
});

export const CartSchema = z.object({
  items: z.array(ItemSchema).min(1).max(50),
  currency: z.string().length(3).default("USD"),
  total: z.number().min(0).optional(),
});

export const OrderBodySchema = z.object({
  sessionId: z.string().min(1).max(100).optional(),
  cartId: z.string().max(64).optional(),
  merchantId: z.string().max(64).optional(),
  items: z.array(ItemSchema).min(1).max(50),
  currency: z.string().length(3).default("USD"),
  contact: ContactSchema.optional(),
  consent: z.boolean().optional(),
  payLaterEligible: z.boolean().optional(),
});

export const EventSchema = z.object({
  type: z.enum(["checkout_started", "order_created", "abandoned"]),
  sessionId: z.string().min(1).max(100),
  merchantId: z.string().max(64).optional(),
  orderId: z.string().max(64).nullish(),
  reason: z.string().max(32).nullish(),
  url: z.string().max(2000).optional(),
  ts: z.number().optional(),
  update: z.boolean().optional(),
  consent: z.boolean().optional(),
  contact: ContactSchema.optional(),
  cart: CartSchema.nullish(),
});

export type EventBody = z.infer<typeof EventSchema>;

/** Only set contact fields that are present and valid. */
export function contactPatch(contact: z.infer<typeof ContactSchema> | undefined): Partial<Cart> {
  const patch: Partial<Cart> = {};
  if (!contact) return patch;
  const phone = normalizePhone(contact.phone);
  if (phone) patch.shopperPhone = phone;
  if (isValidEmail(contact.email)) patch.shopperEmail = contact.email.trim();
  if (contact.name && contact.name.trim()) patch.shopperName = contact.name.trim();
  return patch;
}

export function cleanItems(items: z.infer<typeof ItemSchema>[]) {
  return items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, ...(i.sku ? { sku: i.sku } : {}) }));
}
