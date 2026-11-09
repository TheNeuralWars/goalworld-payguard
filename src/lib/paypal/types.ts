/** Mirrors PayPal Orders v2 order.status values. */
export type OrderStatus =
  | "CREATED"
  | "SAVED"
  | "APPROVED"
  | "VOIDED"
  | "COMPLETED"
  | "PAYER_ACTION_REQUIRED";

export interface CreateOrderInput {
  amountCents: number;
  currency: string;
  payeeEmail: string;
  description: string;
  /** Our proposal id — sent as custom_id and as PayPal-Request-Id for idempotency. */
  customId?: string;
  intent?: "CAPTURE" | "AUTHORIZE";
  /** Where PayPal sends the payer after approve / cancel. */
  returnUrl: string;
  cancelUrl: string;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalOrder {
  id: string;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  payeeEmail: string;
  description: string;
  customId?: string;
  /** rel=payer-action (payment_source flow) or rel=approve (legacy). */
  approveUrl?: string;
  links?: PayPalLink[];
  captureId?: string;
  captureStatus?: string;
  raw?: unknown;
  mode: "mock" | "sandbox";
  createdAt: string;
}

export interface PayoutInput {
  amountCents: number;
  currency: string;
  receiverEmail: string;
  note: string;
  senderItemId: string;
}

/** Mirrors Payouts batch_header.batch_status. */
export type PayoutBatchStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";

export interface PayPalPayout {
  batchId: string;
  status: PayoutBatchStatus | string;
  amountCents: number;
  currency: string;
  receiverEmail: string;
  mode: "mock" | "sandbox";
  createdAt: string;
  raw?: unknown;
}

/** Error shaped like a PayPal REST error (name/issue), e.g. 422 ORDER_NOT_APPROVED. */
export class PayPalApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly issue: string,
    message: string,
    public readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
}

export interface PayPalAdapter {
  readonly mode: "mock" | "sandbox";
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  /** PayPal only captures APPROVED orders; anything else → 422 ORDER_NOT_APPROVED. */
  captureOrder(orderId: string, requestId?: string): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  createPayout(input: PayoutInput): Promise<PayPalPayout>;
  getPayout(batchId: string): Promise<PayPalPayout>;
}

/** Only the mock can stand in for the human payer clicking "Pay" on PayPal. */
export interface PayerApprovalSimulator {
  simulatePayerApproval(orderId: string): Promise<PayPalOrder>;
  simulatePayerCancel(orderId: string): Promise<void>;
}

export function canSimulatePayer(a: PayPalAdapter): a is PayPalAdapter & PayerApprovalSimulator {
  return a.mode === "mock" && typeof (a as Partial<PayerApprovalSimulator>).simulatePayerApproval === "function";
}

export function pickApproveUrl(links: PayPalLink[] | undefined): string | undefined {
  if (!links) return undefined;
  return (links.find((l) => l.rel === "payer-action") || links.find((l) => l.rel === "approve"))?.href;
}
