import { describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/lib/paypal/mock-adapter";
import { PayPalApiError } from "@/lib/paypal/types";

const base = {
  amountCents: 1500,
  currency: "USD",
  payeeEmail: "tools@goalworld.fun",
  description: "API batch",
  returnUrl: "http://127.0.0.1:3047/api/paypal/return?proposal=p1",
  cancelUrl: "http://127.0.0.1:3047/api/paypal/cancel?proposal=p1",
};

async function issueOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PayPalApiError) return `${e.httpStatus} ${e.issue}`;
    throw e;
  }
  return "no error";
}

describe("MockPayPalAdapter mirrors PayPal Orders v2 states", () => {
  it("create → PAYER_ACTION_REQUIRED with a payer-action link", async () => {
    const a = new MockPayPalAdapter();
    const order = await a.createOrder(base);
    expect(order.mode).toBe("mock");
    expect(order.status).toBe("PAYER_ACTION_REQUIRED");
    expect(order.links?.find((l) => l.rel === "payer-action")?.href).toContain(`token=${order.id}`);
    expect(order.approveUrl).toBe(order.links?.find((l) => l.rel === "payer-action")?.href);
  });

  it("capture before payer approval → 422 ORDER_NOT_APPROVED (the bug October found)", async () => {
    const a = new MockPayPalAdapter();
    const order = await a.createOrder(base);
    expect(await issueOf(a.captureOrder(order.id))).toBe("422 ORDER_NOT_APPROVED");
    expect((await a.getOrder(order.id)).status).toBe("PAYER_ACTION_REQUIRED");
  });

  it("approve → APPROVED → capture COMPLETED; second capture → ORDER_ALREADY_CAPTURED", async () => {
    const a = new MockPayPalAdapter();
    const order = await a.createOrder(base);
    expect((await a.simulatePayerApproval(order.id)).status).toBe("APPROVED");
    const cap = await a.captureOrder(order.id);
    expect(cap.status).toBe("COMPLETED");
    expect(cap.captureId).toMatch(/^MOCK-CAP-/);
    expect(await issueOf(a.captureOrder(order.id))).toBe("422 ORDER_ALREADY_CAPTURED");
  });

  it("requires return/cancel URLs (experience_context) and positive integer cents", async () => {
    const a = new MockPayPalAdapter();
    expect(await issueOf(a.createOrder({ ...base, returnUrl: "" }))).toBe("422 MISSING_REQUIRED_PARAMETER");
    expect(await issueOf(a.createOrder({ ...base, amountCents: 10.5 }))).toBe("422 INVALID_PARAMETER_VALUE");
  });

  it("PayPal-Request-Id idempotency: same customId → same order", async () => {
    const a = new MockPayPalAdapter();
    const o1 = await a.createOrder({ ...base, customId: "prop_x" });
    const o2 = await a.createOrder({ ...base, customId: "prop_x" });
    expect(o2.id).toBe(o1.id);
    expect(a._allOrders()).toHaveLength(1);
  });

  it("return target carries token=<orderId> like PayPal", async () => {
    const a = new MockPayPalAdapter();
    const o = await a.createOrder(base);
    expect(a.returnTarget(o.id, true)).toBe(`${base.returnUrl}&token=${o.id}&PayerID=MOCKPAYER`);
    expect(a.returnTarget(o.id, false)).toContain("/api/paypal/cancel?proposal=p1&token=");
  });

  it("payout batch PENDING → SUCCESS on poll", async () => {
    const a = new MockPayPalAdapter();
    const payout = await a.createPayout({
      amountCents: 2500,
      currency: "USD",
      receiverEmail: "creator@goalworld.fun",
      note: "VO polish",
      senderItemId: "prop_test",
    });
    expect(payout.batchId).toMatch(/^MOCK-BATCH-/);
    expect(payout.status).toBe("PENDING");
    expect((await a.getPayout(payout.batchId)).status).toBe("SUCCESS");
  });
});
