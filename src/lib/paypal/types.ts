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
  customId?: string;
  intent?: "CAPTURE" | "AUTHORIZE";
}

export interface PayPalOrder {
  id: string;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  payeeEmail: string;
  description: string;
  captureId?: string;
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

export interface PayPalPayout {
  batchId: string;
  status: string;
  amountCents: number;
  currency: string;
  receiverEmail: string;
  mode: "mock" | "sandbox";
  createdAt: string;
  raw?: unknown;
}

export interface PayPalAdapter {
  readonly mode: "mock" | "sandbox";
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  captureOrder(orderId: string): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  createPayout(input: PayoutInput): Promise<PayPalPayout>;
}
