export type ProposalStatus =
  | "proposed"
  | "guard_rejected"
  | "awaiting_human"
  | "approved"
  /** Orders v2: order created, waiting for the PayPal payer to approve (approve link). */
  | "awaiting_payer_approval"
  /** Payer cancelled on PayPal (cancel_url) — reservation released, nothing captured. */
  | "payer_cancelled"
  | "executed"
  | "failed"
  | "human_rejected";

export type RiskLevel = "low" | "medium" | "high";

export type ReasonerKind = "heuristic" | "llm" | "llm_fallback";

export type PaymentCategory = "creator_payout" | "tool_api" | "ops_escrow" | "other";

export interface PaymentIntent {
  /** Natural language what the agent wants to pay for */
  intent: string;
  payeeEmail?: string;
  amountCents?: number;
  currency?: string;
  category?: PaymentCategory;
}

/** Which brain produced a step, and how. Shown in UI + audit so judges see real AI vs fallback. */
export interface ReasonerTrace {
  kind: ReasonerKind;
  model?: string;
  latencyMs?: number;
  fallbackReason?: string;
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
  orderStatus?: string;
  /** PayPal payer approval link (rel=payer-action / approve). */
  approveUrl?: string;
  captureId?: string;
  payoutBatchId?: string;
  payoutStatus?: string;
  error?: string;
  reasoner: ReasonerKind;
  proposeTrace?: ReasonerTrace;
  riskTrace?: ReasonerTrace;
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
  /** AI recommendation. Can only make the verdict stricter — never relax policy. */
  aiRecommendation?: "approve" | "review" | "block";
}

export interface ProposeDraft {
  payeeEmail: string;
  amountCents: number;
  currency: string;
  reason: string;
  category: string;
  notes: string;
  trace: ReasonerTrace;
}

export interface RiskInput {
  payeeEmail: string;
  amountCents: number;
  reason: string;
  intent: string;
  category?: string;
  allowlisted?: boolean;
  perTxCents?: number;
  remainingDailyCents?: number;
}

export interface RiskAssessment {
  riskLevel: RiskLevel;
  riskFlags: string[];
  summary: string;
  recommendation: "approve" | "review" | "block";
  trace: ReasonerTrace;
}

export interface Reasoner {
  readonly kind: "heuristic" | "llm";
  readonly model?: string;
  propose(intent: PaymentIntent, context: ProposeContext): Promise<ProposeDraft>;
  assessRisk(proposal: RiskInput): Promise<RiskAssessment>;
}

export interface ProposeContext {
  allowPayees: string[];
  perTxCents: number;
  remainingDailyCents: number;
  currency: string;
}
