import { describe, expect, it } from "vitest";
import { SandboxPayPalAdapter } from "@/lib/paypal/sandbox-adapter";
import { PayPalApiError } from "@/lib/paypal/types";

const BASE = "https://api-m.sandbox.paypal.com";

function stubPayPal(handler: (path: string, init: RequestInit) => Response) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(BASE, "");
    calls.push({ path, init: init ?? {} });
    if (path === "/v1/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "A21-test", expires_in: 3600 }), { status: 200 });
    }
    return handler(path, init ?? {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const input = {
  amountCents: 900,
  currency: "USD",
  payeeEmail: "tools@goalworld.fun",
  description: "Tavily research batch",
  customId: "prop_abc",
  returnUrl: "http://127.0.0.1:3047/api/paypal/return?proposal=prop_abc",
  cancelUrl: "http://127.0.0.1:3047/api/paypal/cancel?proposal=prop_abc",
};

describe("SandboxPayPalAdapter — Orders v2 request shape (no network)", () => {
  it("creates with payment_source.paypal.experience_context, items[], idempotency key; parses payer-action", async () => {
    const { fetchImpl, calls } = stubPayPal(() =>
      new Response(
        JSON.stringify({
          id: "5O190127TN364715T",
          status: "PAYER_ACTION_REQUIRED",
          links: [
            { href: `${BASE}/v2/checkout/orders/5O190127TN364715T`, rel: "self", method: "GET" },
            { href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", rel: "payer-action", method: "GET" },
          ],
        }),
        { status: 200 },
      ),
    );
    const a = new SandboxPayPalAdapter("id", "secret", BASE, fetchImpl);
    const order = await a.createOrder(input);
    expect(order.status).toBe("PAYER_ACTION_REQUIRED");
    expect(order.approveUrl).toBe("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T");

    const create = calls.find((c) => c.path === "/v2/checkout/orders")!;
    const headers = create.init.headers as Record<string, string>;
    expect(headers["PayPal-Request-Id"]).toBe("payguard-order-prop_abc");
    const body = JSON.parse(String(create.init.body));
    expect(body.intent).toBe("CAPTURE");
    expect(body.payment_source.paypal.experience_context).toMatchObject({
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
    });
    const pu = body.purchase_units[0];
    expect(pu.amount).toEqual({ currency_code: "USD", value: "9.00", breakdown: { item_total: { currency_code: "USD", value: "9.00" } } });
    expect(pu.items).toEqual([expect.objectContaining({ quantity: "1", unit_amount: { currency_code: "USD", value: "9.00" } })]);
    expect(pu.payee).toEqual({ email_address: "tools@goalworld.fun" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("maps PayPal 422 ORDER_NOT_APPROVED into PayPalApiError.issue", async () => {
    const { fetchImpl } = stubPayPal(() =>
      new Response(
        JSON.stringify({ name: "UNPROCESSABLE_ENTITY", debug_id: "dbg1", details: [{ issue: "ORDER_NOT_APPROVED" }] }),
        { status: 422 },
      ),
    );
    const a = new SandboxPayPalAdapter("id", "secret", BASE, fetchImpl);
    const err = await a.captureOrder("5O190127TN364715T", "prop_abc").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.httpStatus).toBe(422);
    expect(err.issue).toBe("ORDER_NOT_APPROVED");
    expect(err.debugId).toBe("dbg1");
  });

  it("parses a COMPLETED capture", async () => {
    const { fetchImpl, calls } = stubPayPal(() =>
      new Response(
        JSON.stringify({
          id: "5O190127TN364715T",
          status: "COMPLETED",
          purchase_units: [{ payments: { captures: [{ id: "3C679366HH908993F", status: "COMPLETED", amount: { value: "9.00", currency_code: "USD" } }] } }],
        }),
        { status: 201 },
      ),
    );
    const a = new SandboxPayPalAdapter("id", "secret", BASE, fetchImpl);
    const o = await a.captureOrder("5O190127TN364715T", "prop_abc");
    expect(o.status).toBe("COMPLETED");
    expect(o.captureId).toBe("3C679366HH908993F");
    const cap = calls.find((c) => c.path.endsWith("/capture"))!;
    expect((cap.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("payguard-capture-prop_abc");
  });

  it("Payouts body uses {value, currency} (real sandbox rejected currency_code)", () => {
    const a = new SandboxPayPalAdapter("id", "secret", BASE, (async () => new Response("{}")) as unknown as typeof fetch);
    const body = a.buildPayoutBody({ amountCents: 100, currency: "USD", receiverEmail: "creator@goalworld.fun", note: "smoke", senderItemId: "prop_1" });
    expect(body.items[0]!.amount).toEqual({ value: "1.00", currency: "USD" });
    expect(body.sender_batch_header.sender_batch_id).toBe("payguard-prop_1");
  });
});
