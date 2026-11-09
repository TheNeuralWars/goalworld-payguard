import { randomUUID } from "node:crypto";
import type {
  CreateOrderInput,
  PayPalAdapter,
  PayPalOrder,
  PayPalPayout,
  PayoutInput,
} from "./types";

/** Realistic in-memory PayPal sandbox stand-in. Default for local/dev/tests. */
export class MockPayPalAdapter implements PayPalAdapter {
  readonly mode = "mock" as const;
  private orders = new Map<string, PayPalOrder>();
  private payouts = new Map<string, PayPalPayout>();

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    if (input.amountCents <= 0) throw new Error("mock: amount must be positive");
    const order: PayPalOrder = {
      id: `MOCK-ORDER-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "CREATED",
      amountCents: input.amountCents,
      currency: input.currency,
      payeeEmail: input.payeeEmail,
      description: input.description,
      mode: "mock",
      createdAt: new Date().toISOString(),
      raw: { intent: input.intent || "CAPTURE", custom_id: input.customId },
    };
    this.orders.set(order.id, order);
    return { ...order };
  }

  async captureOrder(orderId: string): Promise<PayPalOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: order not found ${orderId}`);
    if (order.status === "COMPLETED") return { ...order };
    if (order.status !== "CREATED" && order.status !== "APPROVED") {
      throw new Error(`mock: cannot capture status ${order.status}`);
    }
    order.status = "COMPLETED";
    order.captureId = `MOCK-CAP-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.orders.set(orderId, order);
    return { ...order };
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`mock: order not found ${orderId}`);
    return { ...order };
  }

  async createPayout(input: PayoutInput): Promise<PayPalPayout> {
    if (input.amountCents <= 0) throw new Error("mock: amount must be positive");
    const payout: PayPalPayout = {
      batchId: `MOCK-BATCH-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: "SUCCESS",
      amountCents: input.amountCents,
      currency: input.currency,
      receiverEmail: input.receiverEmail,
      mode: "mock",
      createdAt: new Date().toISOString(),
      raw: { sender_item_id: input.senderItemId, note: input.note },
    };
    this.payouts.set(payout.batchId, payout);
    return { ...payout };
  }

  /** test introspection */
  _allOrders(): PayPalOrder[] {
    return [...this.orders.values()].map((o) => ({ ...o }));
  }
}
