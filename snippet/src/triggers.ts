/**
 * Client-side abandonment triggers. A small clock-driven state machine so the
 * rules are deterministic and testable:
 *   - cancel: the PayPal popup was closed (merchant calls Hollaback.cancelled)
 *   - idle: no interaction for 45s after a PayPal order was created. Idle time only
 *     accrues while the page is visible and focused: an open PayPal popup takes focus,
 *     so a shopper who is busy approving is never counted as idle.
 *   - hidden: tab hidden for 20s after a PayPal order was created
 *   - exit_intent: pointer leaves through the top of the viewport after an order exists
 *   - pagehide: the page is being unloaded after an order exists
 * Each order fires at most one abandonment signal; approval disarms everything.
 */

export type AbandonReason = "cancel" | "idle" | "hidden" | "exit_intent" | "pagehide";

export interface TriggerOptions {
  idleMs: number;
  hiddenMs: number;
}

export const DEFAULT_TRIGGERS: TriggerOptions = { idleMs: 45_000, hiddenMs: 20_000 };

export class AbandonTriggers {
  private orderId: string | null = null;
  private lastActivity = 0;
  private hiddenSince: number | null = null;
  private focused = true;
  private fired = false;
  private approved = false;

  constructor(private readonly opts: TriggerOptions = DEFAULT_TRIGGERS) {}

  get currentOrderId(): string | null {
    return this.orderId;
  }

  get armed(): boolean {
    return this.orderId !== null && !this.fired && !this.approved;
  }

  orderCreated(orderId: string, now: number): boolean {
    if (this.orderId === orderId) return false;
    this.orderId = orderId;
    this.lastActivity = now;
    this.fired = false;
    this.approved = false;
    return true;
  }

  activity(now: number): void {
    this.lastActivity = now;
  }

  visibility(hidden: boolean, now: number): void {
    if (hidden) {
      if (this.hiddenSince === null) this.hiddenSince = now;
    } else {
      this.hiddenSince = null;
      this.lastActivity = now;
    }
  }

  focus(focused: boolean, now: number): void {
    this.focused = focused;
    // Idle time restarts when the shopper comes back from the PayPal popup.
    if (focused) this.lastActivity = now;
  }

  approve(): void {
    this.approved = true;
  }

  /** Immediate triggers (cancel, exit intent, pagehide). */
  fire(reason: AbandonReason): AbandonReason | null {
    if (!this.armed) return null;
    this.fired = true;
    return reason;
  }

  /** Time-based triggers. Call on an interval. */
  tick(now: number): AbandonReason | null {
    if (!this.armed) return null;
    if (this.hiddenSince !== null) {
      return now - this.hiddenSince >= this.opts.hiddenMs ? this.fire("hidden") : null;
    }
    if (!this.focused) {
      this.lastActivity = now;
      return null;
    }
    return now - this.lastActivity >= this.opts.idleMs ? this.fire("idle") : null;
  }
}
