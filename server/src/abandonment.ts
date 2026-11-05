import type { PayPalClient } from "./paypal/client.js";
import type { Cart, Store } from "./store/types.js";

/**
 * Server-side abandonment confirmation.
 *
 * PayPal has no "order abandoned" webhook, so the snippet reports browser signals and
 * the server confirms them against Orders v2:
 *   1. order_created starts a grace timer (GRACE_MS, default 30s).
 *   2. When the timer fires we GET /v2/checkout/orders/{id}.
 *   3. `abandoned` fires only if the order is still CREATED or PAYER_ACTION_REQUIRED and
 *      the browser has signalled abandonment (popup cancelled, idle, hidden tab, exit
 *      intent), or the order has sat unpaid for ABANDON_MAX_WAIT_MS (snippet blocked).
 *      A shopper who is still typing their PayPal password is never flagged.
 *   4. APPROVED / COMPLETED means they paid; VOIDED means the order expired.
 */

export const PENDING_ORDER_STATUSES: ReadonlySet<string> = new Set(["CREATED", "PAYER_ACTION_REQUIRED"]);

export type OrderPhase = "pending" | "paid" | "voided" | "unknown";

export function classifyOrderStatus(status: string | null | undefined): OrderPhase {
  if (!status) return "unknown";
  if (PENDING_ORDER_STATUSES.has(status)) return "pending";
  if (status === "APPROVED" || status === "COMPLETED") return "paid";
  if (status === "VOIDED") return "voided";
  return "unknown";
}

/** Signals strong enough to confirm quickly (the shopper explicitly closed PayPal). */
export const STRONG_SIGNALS: ReadonlySet<string> = new Set(["cancel"]);

export type CheckResult = "abandoned" | "paid" | "expired" | "waiting" | "skipped";

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface MonitorOptions {
  store: Store;
  paypal: Pick<PayPalClient, "getOrder">;
  graceMs: number;
  maxWaitMs: number;
  /** Delay before confirming a strong signal such as a cancelled popup. */
  settleMs?: number;
  onAbandoned: (cart: Cart) => void | Promise<void>;
  onPaid?: (cart: Cart) => void | Promise<void>;
  log?: Logger;
  now?: () => number;
}

interface Watch {
  cartId: string;
  orderId: string;
  createdAt: number;
  signal: { reason: string; at: number } | null;
  timer: ReturnType<typeof setTimeout> | null;
  dueAt: number;
}

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export class AbandonmentMonitor {
  private readonly watches = new Map<string, Watch>();
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly settleMs: number;

  constructor(private readonly opts: MonitorOptions) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? silent;
    this.settleMs = opts.settleMs ?? 3_000;
  }

  get watching(): number {
    return this.watches.size;
  }

  isWatching(cartId: string): boolean {
    return this.watches.has(cartId);
  }

  /** Start the grace timer for a newly created PayPal order. Idempotent per order id. */
  orderCreated(cart: Pick<Cart, "id" | "paypalOrderId">): void {
    if (!cart.paypalOrderId) return;
    const existing = this.watches.get(cart.id);
    if (existing?.orderId === cart.paypalOrderId) return;
    if (existing) this.stop(cart.id);
    const t = this.now();
    const watch: Watch = { cartId: cart.id, orderId: cart.paypalOrderId, createdAt: t, signal: null, timer: null, dueAt: 0 };
    this.watches.set(cart.id, watch);
    this.schedule(watch, t + this.opts.graceMs);
  }

  /** Record a browser abandonment signal and make sure a status check is coming. */
  signal(cart: Pick<Cart, "id" | "paypalOrderId" | "orderCreatedAt">, reason: string): void {
    if (!cart.paypalOrderId) return;
    let watch = this.watches.get(cart.id);
    const t = this.now();
    if (!watch || watch.orderId !== cart.paypalOrderId) {
      // e.g. after a server restart: rebuild the watch from the stored order time
      const createdAt = cart.orderCreatedAt ? Date.parse(cart.orderCreatedAt) : t;
      if (watch) this.stop(cart.id);
      watch = { cartId: cart.id, orderId: cart.paypalOrderId, createdAt, signal: null, timer: null, dueAt: 0 };
      this.watches.set(cart.id, watch);
    }
    if (!watch.signal) watch.signal = { reason, at: t };
    const wait = STRONG_SIGNALS.has(reason) ? this.settleMs : this.opts.graceMs;
    const due = Math.max(watch.createdAt + this.opts.graceMs, t + wait);
    if (!watch.timer || due < watch.dueAt) this.schedule(watch, due);
  }

  stop(cartId: string): void {
    const w = this.watches.get(cartId);
    if (w?.timer) clearTimeout(w.timer);
    this.watches.delete(cartId);
  }

  stopAll(): void {
    for (const id of [...this.watches.keys()]) this.stop(id);
  }

  private schedule(watch: Watch, dueAt: number): void {
    if (watch.timer) clearTimeout(watch.timer);
    watch.dueAt = dueAt;
    watch.timer = setTimeout(() => {
      watch.timer = null;
      this.check(watch.cartId).catch((err) => this.log.error({ err, cartId: watch.cartId }, "abandonment check failed"));
    }, Math.max(0, dueAt - this.now()));
  }

  /** Poll the order and decide. Exposed for tests and for manual re-checks. */
  async check(cartId: string): Promise<CheckResult> {
    const watch = this.watches.get(cartId);
    if (!watch) return "skipped";
    const cart = await this.opts.store.getCart(cartId);
    if (!cart || cart.paypalOrderId !== watch.orderId || cart.status !== "pending") {
      this.stop(cartId);
      return "skipped";
    }

    let status: string;
    try {
      status = (await this.opts.paypal.getOrder(watch.orderId)).status;
    } catch (err) {
      this.log.warn({ err, orderId: watch.orderId }, "order status poll failed; retrying after grace");
      this.schedule(watch, this.now() + this.opts.graceMs);
      return "waiting";
    }

    const phase = classifyOrderStatus(status);
    const t = this.now();
    if (phase === "paid") {
      this.stop(cartId);
      const updated = await this.opts.store.updateCart(cartId, { orderStatus: status, status: "paid" });
      this.log.info({ cartId, status }, "order paid before grace expired");
      await this.opts.onPaid?.(updated);
      return "paid";
    }
    if (phase === "voided") {
      this.stop(cartId);
      await this.opts.store.updateCart(cartId, { orderStatus: status, status: "expired" });
      return "expired";
    }
    if (phase === "pending") {
      const timedOut = t - watch.createdAt >= this.opts.maxWaitMs;
      if (watch.signal && !timedOut) {
        // Give the shopper the full settle window after the signal (they may come back).
        const readyAt = watch.signal.at + (STRONG_SIGNALS.has(watch.signal.reason) ? this.settleMs : this.opts.graceMs);
        if (t < readyAt) {
          await this.opts.store.updateCart(cartId, { orderStatus: status });
          this.schedule(watch, readyAt);
          return "waiting";
        }
      }
      if (watch.signal || timedOut) {
        this.stop(cartId);
        const updated = await this.opts.store.updateCart(cartId, {
          orderStatus: status,
          status: "abandoned",
          abandonedAt: new Date(t).toISOString(),
          abandonReason: watch.signal?.reason ?? "timeout",
        });
        this.log.info({ cartId, orderId: watch.orderId, reason: updated.abandonReason }, "checkout abandoned");
        await this.opts.onAbandoned(updated);
        return "abandoned";
      }
    }
    await this.opts.store.updateCart(cartId, { orderStatus: status });
    this.schedule(watch, Math.min(t + this.opts.graceMs, watch.createdAt + this.opts.maxWaitMs));
    return "waiting";
  }
}
