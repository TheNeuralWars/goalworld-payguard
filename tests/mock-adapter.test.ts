import { describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/lib/paypal/mock-adapter";

describe("MockPayPalAdapter", () => {
  it("creates and captures an order", async () => {
    const adapter = new MockPayPalAdapter();
    const order = await adapter.createOrder({
      amountCents: 1500,
      currency: "USD",
      payeeEmail: "tools@goalworld.fun",
      description: "API batch",
    });
    expect(order.mode).toBe("mock");
    expect(order.status).toBe("CREATED");
    const captured = await adapter.captureOrder(order.id);
    expect(captured.status).toBe("COMPLETED");
    expect(captured.captureId).toMatch(/^MOCK-CAP-/);
  });

  it("creates a payout batch", async () => {
    const adapter = new MockPayPalAdapter();
    const payout = await adapter.createPayout({
      amountCents: 2500,
      currency: "USD",
      receiverEmail: "creator@goalworld.fun",
      note: "VO polish",
      senderItemId: "prop_test",
    });
    expect(payout.batchId).toMatch(/^MOCK-BATCH-/);
    expect(payout.status).toBe("SUCCESS");
  });
});
