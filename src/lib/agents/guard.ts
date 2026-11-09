import { isAllowlisted } from "../payee";
import type { SpendPolicy } from "../policy/spend-policy";
import type { GuardVerdict, PaymentProposal, Reasoner, ReasonerKind } from "./types";

function combineKinds(a: ReasonerKind, b: ReasonerKind): ReasonerKind {
  if (a === "llm" && b === "llm") return "llm";
  if (a === "heuristic" && b === "heuristic") return "heuristic";
  return "llm_fallback";
}

/**
 * Guard = deterministic SpendPolicy (authoritative) + AI risk review (advisory, stricter-only).
 *   allowed = policy.ok && ai.recommendation !== "block"
 * The AI can veto; it can never allow what policy refuses.
 */
export async function guardProposal(
  proposal: PaymentProposal,
  policy: SpendPolicy,
  reasoner: Reasoner,
): Promise<PaymentProposal> {
  const policyCheck = policy.check({
    payee: proposal.payeeEmail,
    amountCents: proposal.amountCents,
    currency: proposal.currency,
    reason: proposal.reason,
  });

  const risk = await reasoner.assessRisk({
    payeeEmail: proposal.payeeEmail,
    amountCents: proposal.amountCents,
    reason: proposal.reason,
    intent: proposal.intent,
    category: proposal.category,
    allowlisted: isAllowlisted(proposal.payeeEmail, policy.allowPayees),
    perTxCents: policy.perTxCents,
    remainingDailyCents: policy.remainingDailyCents(),
  });

  // Product rule: every policy-OK payment still needs a human click
  // (agentic commerce with brakes). Risk flags inform the human.
  const requiresHuman = true;
  const aiBlocked = risk.recommendation === "block";
  const allowed = policyCheck.ok && !aiBlocked;

  const verdict: GuardVerdict = {
    allowed,
    policyOk: policyCheck.ok,
    policyReason: policyCheck.ok ? (aiBlocked ? `AI risk veto: ${risk.summary}` : undefined) : policyCheck.reason,
    policyCode: policyCheck.ok ? (aiBlocked ? "AI_RISK_BLOCK" : undefined) : policyCheck.code,
    riskLevel: risk.riskLevel,
    riskFlags: risk.riskFlags,
    summary: !policyCheck.ok
      ? `Policy blocked: ${policyCheck.reason}`
      : aiBlocked
        ? `AI risk veto: ${risk.summary}`
        : risk.summary,
    requiresHuman,
    aiRecommendation: risk.recommendation,
  };

  return {
    ...proposal,
    guard: verdict,
    riskTrace: risk.trace,
    reasoner: combineKinds(proposal.proposeTrace?.kind ?? proposal.reasoner, risk.trace.kind),
    status: allowed ? (requiresHuman ? "awaiting_human" : "approved") : "guard_rejected",
  };
}
