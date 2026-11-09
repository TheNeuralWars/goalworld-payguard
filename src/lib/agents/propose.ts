import { randomUUID } from "node:crypto";
import type { SpendPolicy } from "../policy/spend-policy";
import type { PaymentIntent, PaymentProposal, Reasoner } from "./types";

export async function proposePayment(
  intent: PaymentIntent,
  policy: SpendPolicy,
  reasoner: Reasoner,
): Promise<PaymentProposal> {
  const drafted = await reasoner.propose(intent, {
    allowPayees: [...policy.allowPayees],
    perTxCents: policy.perTxCents,
    remainingDailyCents: policy.remainingDailyCents(),
    currency: policy.currency,
  });

  return {
    id: `prop_${randomUUID().slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    intent: intent.intent,
    payeeEmail: drafted.payeeEmail,
    amountCents: drafted.amountCents,
    currency: drafted.currency,
    reason: drafted.reason,
    category: drafted.category,
    status: "proposed",
    proposeNotes: drafted.notes,
    guard: {
      allowed: false,
      policyOk: false,
      riskLevel: "low",
      riskFlags: [],
      summary: "pending guard",
      requiresHuman: true,
    },
    reasoner: drafted.trace.kind,
    proposeTrace: drafted.trace,
  };
}
