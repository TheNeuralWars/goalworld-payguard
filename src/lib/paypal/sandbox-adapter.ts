import type {
  CreateOrderInput,
  PayPalAdapter,
  PayPalOrder,
  PayPalPayout,
  PayoutInput,
} from "./types";

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
  ) {
    if (!apiBase.includes("sandbox")) {
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
    const res = await fetch(`${this.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`paypal oauth failed ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`paypal ${path} ${res.status}: ${body.slice(0, 400)}`);
    }
    return (await res.json()) as T;
  }

  private valueFromCents(cents: number, currency: string) {
    return {
      currency_code: currency,
      value: (cents / 100).toFixed(2),
    };
  }

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    const body = {
      intent: input.intent || "CAPTURE",
      purchase_units: [
        {
          amount: {
            ...this.valueFromCents(input.amountCents, input.currency),
            breakdown: {
              item_total: this.valueFromCents(input.amountCents, input.currency),
            },
          },
          description: input.description.slice(0, 127),
          custom_id: input.customId,
          payee: { email_address: input.payeeEmail },
        },
      ],
    };
    const raw = await this.api<{
      id: string;
      status: string;
    }>("/v2/checkout/orders", { method: "POST", body: JSON.stringify(body) });

    return {
      id: raw.id,
      status: raw.status as PayPalOrder["status"],
      amountCents: input.amountCents,
      currency: input.currency,
      payeeEmail: input.payeeEmail,
      description: input.description,
      mode: "sandbox",
      createdAt: new Date().toISOString(),
      raw,
    };
  }

  async captureOrder(orderId: string): Promise<PayPalOrder> {
    const raw = await this.api<{
      id: string;
      status: string;
      purchase_units?: Array<{
        payments?: { captures?: Array<{ id: string }> };
        amount?: { value: string; currency_code: string };
        payee?: { email_address?: string };
        description?: string;
      }>;
    }>(`/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      body: "{}",
    });
    const unit = raw.purchase_units?.[0];
    const value = unit?.amount?.value ? Math.round(Number(unit.amount.value) * 100) : 0;
    return {
      id: raw.id,
      status: raw.status as PayPalOrder["status"],
      amountCents: value,
      currency: unit?.amount?.currency_code || "USD",
      payeeEmail: unit?.payee?.email_address || "",
      description: unit?.description || "",
      captureId: unit?.payments?.captures?.[0]?.id,
      mode: "sandbox",
      createdAt: new Date().toISOString(),
      raw,
    };
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    const raw = await this.api<{
      id: string;
      status: string;
      purchase_units?: Array<{
        amount?: { value: string; currency_code: string };
        payee?: { email_address?: string };
        description?: string;
        payments?: { captures?: Array<{ id: string }> };
      }>;
    }>(`/v2/checkout/orders/${orderId}`);
    const unit = raw.purchase_units?.[0];
    const value = unit?.amount?.value ? Math.round(Number(unit.amount.value) * 100) : 0;
    return {
      id: raw.id,
      status: raw.status as PayPalOrder["status"],
      amountCents: value,
      currency: unit?.amount?.currency_code || "USD",
      payeeEmail: unit?.payee?.email_address || "",
      description: unit?.description || "",
      captureId: unit?.payments?.captures?.[0]?.id,
      mode: "sandbox",
      createdAt: new Date().toISOString(),
      raw,
    };
  }

  async createPayout(input: PayoutInput): Promise<PayPalPayout> {
    const body = {
      sender_batch_header: {
        sender_batch_id: `payguard-${input.senderItemId}`.slice(0, 64),
        email_subject: "GoalWorld PayGuard payout",
        email_message: input.note.slice(0, 1000),
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: this.valueFromCents(input.amountCents, input.currency),
          note: input.note.slice(0, 1000),
          sender_item_id: input.senderItemId.slice(0, 63),
          receiver: input.receiverEmail,
        },
      ],
    };
    const raw = await this.api<{
      batch_header: { payout_batch_id: string; batch_status: string };
    }>("/v1/payments/payouts", { method: "POST", body: JSON.stringify(body) });

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
