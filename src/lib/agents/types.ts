export type ProposalStatus =
  | "proposed"
  | "guard_rejected"
  | "awaiting_human"
  | "approved"
  | "executed"
  | "failed"
  | "human_rejected";

export type RiskLevel = "low" | "medium" | "high";

export interface PaymentIntent {
  /** Natural language what the agent wants to pay for */
  intent: string;
  payeeEmail?: string;
  amountCents?: number;
  currency?: string;
  category?: "creator_payout" | "tool_api" | "ops_escrow" | "other";
}

export interface PaymentProposal {
  id: string;
  createdAt: string;
  intent: string;
  payeeEmail: string;
  amountCents: number;
  currency: string;
  reason: string;
  category: string;
  status: ProposalStatus;
  proposeNotes: string;
  guard: GuardVerdict;
  orderId?: string;
  captureId?: string;
  payoutBatchId?: string;
  error?: string;
  reasoner: "heuristic" | "llm";
}

export interface GuardVerdict {
  allowed: boolean;
  policyOk: boolean;
  policyReason?: string;
  policyCode?: string;
  riskLevel: RiskLevel;
  riskFlags: string[];
  summary: string;
  requiresHuman: boolean;
}

export interface Reasoner {
  readonly kind: "heuristic" | "llm";
  propose(intent: PaymentIntent, context: ProposeContext): Promise<{
    payeeEmail: string;
    amountCents: number;
    currency: string;
    reason: string;
    category: string;
    notes: string;
  }>;
  assessRisk(proposal: {
    payeeEmail: string;
    amountCents: number;
    reason: string;
    intent: string;
  }): Promise<{ riskLevel: RiskLevel; riskFlags: string[]; summary: string }>;
}

export interface ProposeContext {
  allowPayees: string[];
  perTxCents: number;
  remainingDailyCents: number;
  currency: string;
}
