import type { SpendPolicy } from "../policy/spend-policy";
import type { GuardVerdict, PaymentProposal, Reasoner } from "./types";

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
  });

  // MVP product rule: every policy-OK payment still needs a human click
  // (agentic commerce with brakes). Risk flags still inform the UI.
  const requiresHuman = true;

  const verdict: GuardVerdict = {
    allowed: policyCheck.ok,
    policyOk: policyCheck.ok,
    policyReason: policyCheck.ok ? undefined : policyCheck.reason,
    policyCode: policyCheck.ok ? undefined : policyCheck.code,
    riskLevel: risk.riskLevel,
    riskFlags: risk.riskFlags,
    summary: policyCheck.ok
      ? risk.summary
      : `Policy blocked: ${policyCheck.reason}`,
    requiresHuman,
  };

  return {
    ...proposal,
    guard: verdict,
    status: policyCheck.ok ? (requiresHuman ? "awaiting_human" : "approved") : "guard_rejected",
  };
}
