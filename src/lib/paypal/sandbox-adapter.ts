import { assertSandboxBase } from "../config";
import {
  PayPalApiError,
  pickApproveUrl,
  type CreateOrderInput,
  type PayPalAdapter,
  type PayPalLink,
  type PayPalOrder,
  type PayPalPayout,
  type PayoutInput,
} from "./types";

interface RawOrder {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    custom_id?: string;
    description?: string;
    amount?: { value: string; currency_code: string };
    payee?: { email_address?: string };
    payments?: { captures?: Array<{ id: string; status?: string }> };
  }>;
}

const TRANSIENT = /EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|fetch failed/;

/** Retry only network-level failures (DNS flaps etc.). Safe: writes carry PayPal-Request-Id. */
async function withNetRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = `${(e as Error)?.message ?? ""} ${((e as { cause?: { code?: string } })?.cause?.code) ?? ""}`;
      if (!TRANSIENT.test(msg) || i === tries - 1) throw e;
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw last;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

/**
 * Live PayPal REST against **sandbox only**.
 * Activated when PAYGUARD_MODE=sandbox and vault provides CLIENT_ID/SECRET.
 * Refuses any non-sandbox API base.
 */
export class SandboxPayPalAdapter implements PayPalAdapter {
  readonly mode = "sandbox" as const;
  private token: TokenCache | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly apiBase: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    try {
      assertSandboxBase(apiBase);
    } catch {
      throw new Error("SandboxPayPalAdapter refuses non-sandbox API base");
    }
    if (!clientId || !clientSecret) {
      throw new Error("SandboxPayPalAdapter requires client id/secret");
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 30_000) {
      return this.token.accessToken;
    }
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await withNetRetry(() => this.fetchImpl(`${this.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
    }));
    if (!res.ok) {
      const body = await res.text();
      throw new PayPalApiError(res.status, "OAUTH_FAILED", `paypal oauth failed ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  private async api<T>(path: string, init?: RequestInit & { requestId?: string }): Promise<T> {
    const token = await this.getAccessToken();
    const res = await withNetRetry(() => this.fetchImpl(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(init?.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(30_000),
    }));
    if (!res.ok) {
      const body = await res.text();
      let issue = `HTTP_${res.status}`;
      let debugId: string | undefined;
      try {
        const j = JSON.parse(body) as { name?: string; debug_id?: string; details?: Array<{ issue?: string }> };
        issue = j.details?.[0]?.issue || j.name || issue;
        debugId = j.debug_id;
      } catch {
        /* non-JSON */
      }
      throw new PayPalApiError(res.status, issue, `paypal ${path} ${res.status} ${issue}: ${body.slice(0, 300)}`, debugId);
    }
    return (await res.json()) as T;
  }

  private valueFromCents(cents: number, currency: string) {
    return {
      currency_code: currency,
      value: (cents / 100).toFixed(2),
    };
  }

  /** Exposed for tests: the exact Payouts v1 request body (no secrets inside). */
  buildPayoutBody(input: PayoutInput) {
    return {
      sender_batch_header: {
        sender_batch_id: `payguard-${input.senderItemId}`.slice(0, 64),
        email_subject: "GoalWorld PayGuard payout",
        email_message: input.note.slice(0, 1000),
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: (input.amountCents / 100).toFixed(2), currency: input.currency },
          note: input.note.slice(0, 1000),
          sender_item_id: input.senderItemId.slice(0, 63),
          receiver: input.receiverEmail,
        },
      ],
    };
  }

  /** Exposed for tests: the exact Orders v2 request body (no secrets inside). */
  buildOrderBody(input: CreateOrderInput) {
    const money = this.valueFromCents(input.amountCents, input.currency);
    return {
      intent: input.intent || "CAPTURE",
      purchase_units: [
        {
          reference_id: (input.customId || "payguard").slice(0, 256),
          custom_id: input.customId?.slice(0, 127),
          description: input.description.slice(0, 127),
          payee: { email_address: input.payeeEmail },
          amount: { ...money, breakdown: { item_total: money } },
          items: [
            {
              name: input.description.slice(0, 127) || "GoalWorld PayGuard payment",
              quantity: "1",
              unit_amount: money,
              category: "DIGITAL_GOODS",
            },
          ],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "GoalWorld PayGuard",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            landing_page: "LOGIN",
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    };
  }

  private toOrder(raw: RawOrder, fallback?: CreateOrderInput): PayPalOrder {
    const unit = raw.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    const value = unit?.amount?.value
      ? Math.round(Number(unit.amount.value) * 100)
      : fallback?.amountCents || 0;
    return {
      id: raw.id,
      status: raw.status as PayPalOrder["status"],
      amountCents: value,
      currency: unit?.amount?.currency_code || fallback?.currency || "USD",
      payeeEmail: unit?.payee?.email_address || fallback?.payeeEmail || "",
      description: unit?.description || fallback?.description || "",
      customId: unit?.custom_id || fallback?.customId,
      links: raw.links,
      approveUrl: pickApproveUrl(raw.links),
      captureId: capture?.id,
      captureStatus: capture?.status,
      mode: "sandbox",
      createdAt: new Date().toISOString(),
      raw,
    };
  }

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    const raw = await this.api<RawOrder>("/v2/checkout/orders", {
      method: "POST",
      body: JSON.stringify(this.buildOrderBody(input)),
      requestId: input.customId ? `payguard-order-${input.customId}` : undefined,
    });
    return this.toOrder(raw, input);
  }

  async captureOrder(orderId: string, requestId?: string): Promise<PayPalOrder> {
    const raw = await this.api<RawOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      body: "{}",
      requestId: requestId ? `payguard-capture-${requestId}` : undefined,
    });
    return this.toOrder(raw);
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    const raw = await this.api<RawOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    return this.toOrder(raw);
  }

  async getPayout(batchId: string): Promise<PayPalPayout> {
    const raw = await this.api<{
      batch_header: {
        payout_batch_id: string;
        batch_status: string;
        amount?: { value: string; currency: string };
      };
      items?: Array<{ payout_item?: { receiver?: string } }>;
    }>(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);
    return {
      batchId: raw.batch_header.payout_batch_id,
      status: raw.batch_header.batch_status,
      amountCents: raw.batch_header.amount ? Math.round(Number(raw.batch_header.amount.value) * 100) : 0,
      currency: raw.batch_header.amount?.currency || "USD",
      receiverEmail: raw.items?.[0]?.payout_item?.receiver || "",
      mode: "sandbox",
      createdAt: new Date().toISOString(),
      raw,
    };
  }

  async createPayout(input: PayoutInput): Promise<PayPalPayout> {
    const body = this.buildPayoutBody(input);
    const raw = await this.api<{
      batch_header: { payout_batch_id: string; batch_status: string };
    }>("/v1/payments/payouts", {
      method: "POST",
      body: JSON.stringify(body),
      requestId: `payguard-payout-${input.senderItemId}`,
    });

    return {
      batchId: raw.batch_header.payout_batch_id,
      status: raw.batch_header.batch_status,
      amountCents: input.amountCents,
      currency: input.currency,
      receiverEmail: input.receiverEmail,
      mode: "sandbox",
      createdAt: new Date().toISOString(),
      raw,
    };
  }
}
