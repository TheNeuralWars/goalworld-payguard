import { randomUUID } from "node:crypto";
import {
  PayPalApiError,
  pickApproveUrl,
  type CreateOrderInput,
  type PayerApprovalSimulator,
  type PayPalAdapter,
  type PayPalOrder,
  type PayPalPayout,
  type PayoutInput,
} from "./types";

export interface MockAdapterOptions {
  /** Base URL of the local mock "PayPal approval" page (e.g. http://127.0.0.1:3047). */
  approvalBaseUrl?: string;
}

/**
 * In-memory PayPal stand-in that follows the REAL state machine so the same
 * pipeline works unchanged against api-m.sandbox.paypal.com:
 *
 *   Orders v2:  create (payment_source.paypal + experience_context)
 *                 → PAYER_ACTION_REQUIRED + links[rel=payer-action]
 *               payer approves on PayPal → APPROVED
 *               capture → COMPLETED (+ capture id)
 *               capture before approval → 422 ORDER_NOT_APPROVED
 *               capture twice            → 422 ORDER_ALREADY_CAPTURED
 *   Payouts:    create → PENDING; later GET → SUCCESS
 */
export class MockPayPalAdapter implements PayPalAdapter, PayerApprovalSimulator {
  readonly mode = "mock" as const;
  private orders = new Map<string, PayPalOrder & { returnUrl: string; cancelUrl: string }>();
  private requestIds = new Map<string, string>();
  private payouts = new Map<string, PayPalPayout & { polls: number }>();
  private approvalBaseUrl: string;

  constructor(opts: MockAdapterOptions = {}) {
    this.approvalBaseUrl = (opts.approvalBaseUrl || "http://127.0.0.1:3047").replace(/\/$/, "");
  }

  private view(o: PayPalOrder & { returnUrl?: string; cancelUrl?: string }): PayPalOrder {
    const { returnUrl: _r, cancelUrl: _c, ...copy } = o;
    return { ...copy, links: copy.links ? copy.links.map((l) => ({ ...l })) : undefined };
  }

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new PayPalApiError(422, "INVALID_PARAMETER_VALUE", "mock: amount must be positive integer cents");
    }
    if (!input.returnUrl || !input.cancelUrl) {
      throw new PayPalApiError(422, "MISSING_REQUIRED_PARAMETER", "mock: experience_context return_url/cancel_url required");
    }
    // PayPal-Request-Id idempotency: same request id → same order
    if (input.customId && this.requestIds.has(input.customId)) {
      return this.view(this.orders.get(this.requestIds.get(input.customId)!)!);
    }
    const id = `MOCK-ORDER-${randomUUID().slice(0, 8).toUpperCase()}`;
    const links = [
      { href: `${this.approvalBaseUrl}/api/mock-paypal/orders/${id}`, rel: "self", method: "GET" },
      {
        href: `${this.approvalBaseUrl}/mock-paypal/checkout?token=${id}`,
        rel: "payer-action",
        method: "GET",
      },
    ];
    const order = {
      id,
      status: "PAYER_ACTION_REQUIRED" as const,
      amountCents: input.amountCents,
      currency: input.currency,
      payeeEmail: input.payeeEmail,
      description: input.description,
      customId: input.customId,
      links,
      approveUrl: pickApproveUrl(links),
      mode: "mock" as const,
      createdAt: new Date().toISOString(),
      raw: { intent: input.intent || "CAPTURE", custom_id: input.customId },
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    };
    this.orders.set(id, order);
    if (input.customId) this.requestIds.set(input.customId, id);
    return this.view(order);
  }

  async simulatePayerApproval(orderId: string): Promise<PayPalOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", `mock: order not found ${orderId}`);
    if (order.status === "PAYER_ACTION_REQUIRED" || order.status === "CREATED") {
      order.status = "APPROVED";
    } else if (order.status !== "APPROVED") {
      throw new PayPalApiError(422, "ORDER_CANNOT_BE_APPROVED", `mock: cannot approve ${order.status}`);
    }
    return this.view(order);
  }

  async simulatePayerCancel(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", `mock: order not found ${orderId}`);
    // PayPal leaves the order un-approved; it simply expires. We keep the status.
  }

  /** Where the mock approval page redirects (PayPal appends ?token=<orderId>). */
  returnTarget(orderId: string, approved: boolean): string {
    const order = this.orders.get(orderId);
    if (!order) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", `mock: order not found ${orderId}`);
    const base = approved ? order.returnUrl : order.cancelUrl;
    return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(orderId)}&PayerID=MOCKPAYER`;
  }

  async captureOrder(orderId: string): Promise<PayPalOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", `mock: order not found ${orderId}`);
    if (order.status === "COMPLETED") {
      throw new PayPalApiError(422, "ORDER_ALREADY_CAPTURED", "Order already captured.");
    }
    if (order.status !== "APPROVED") {
      throw new PayPalApiError(
        422,
        "ORDER_NOT_APPROVED",
        "Payer has not yet approved the Order for payment.",
      );
    }
    order.status = "COMPLETED";
    order.captureId = `MOCK-CAP-${randomUUID().slice(0, 8).toUpperCase()}`;
    order.captureStatus = "COMPLETED";
    return this.view(order);
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", `mock: order not found ${orderId}`);
    return this.view(order);
  }

  async createPayout(input: PayoutInput): Promise<PayPalPayout> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new PayPalApiError(422, "VALIDATION_ERROR", "mock: amount must be positive integer cents");
    }
    const payout = {
      batchId: `MOCK-BATCH-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "PENDING",
      amountCents: input.amountCents,
      currency: input.currency,
      receiverEmail: input.receiverEmail,
      mode: "mock" as const,
      createdAt: new Date().toISOString(),
      raw: { sender_item_id: input.senderItemId, note: input.note },
      polls: 0,
    };
    this.payouts.set(payout.batchId, payout);
    const { polls: _p, ...view } = payout;
    return { ...view };
  }

  async getPayout(batchId: string): Promise<PayPalPayout> {
    const p = this.payouts.get(batchId);
    if (!p) throw new PayPalApiError(404, "INVALID_RESOURCE_ID", `mock: payout not found ${batchId}`);
    p.polls += 1;
    if (p.status === "PENDING") p.status = "SUCCESS";
    const { polls: _p, ...view } = p;
    return { ...view };
  }

  /** test introspection */
  _allOrders(): PayPalOrder[] {
    return [...this.orders.values()].map((o) => this.view(o));
  }
}
