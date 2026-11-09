import { SpendPolicy } from "./policy/spend-policy";
import type { PayPalAdapter } from "./paypal/types";
import { proposePayment } from "./agents/propose";
import { guardProposal } from "./agents/guard";
import type { PaymentIntent, PaymentProposal, Reasoner } from "./agents/types";
import { AuditStore } from "./audit/store";
import { formatUsd } from "./money";

export class PayGuardPipeline {
  constructor(
    public readonly policy: SpendPolicy,
    public readonly adapter: PayPalAdapter,
    public readonly reasoner: Reasoner,
    public readonly audit: AuditStore,
  ) {}

  async submitIntent(intent: PaymentIntent): Promise<PaymentProposal> {
    let proposal = await proposePayment(intent, this.policy, this.reasoner);
    await this.audit.saveProposal(proposal);
    await this.audit.append({
      type: "propose",
      proposalId: proposal.id,
      detail: `Proposed ${formatUsd(proposal.amountCents)} → ${proposal.payeeEmail}`,
      meta: { reasoner: proposal.reasoner, category: proposal.category },
    });

    proposal = await guardProposal(proposal, this.policy, this.reasoner);
    await this.audit.saveProposal(proposal);
    await this.audit.append({
      type: "guard",
      proposalId: proposal.id,
      detail: proposal.guard.summary,
      meta: {
        status: proposal.status,
        policyOk: proposal.guard.policyOk,
        risk: proposal.guard.riskLevel,
      },
    });
    return proposal;
  }

  async humanApprove(proposalId: string): Promise<PaymentProposal> {
    const existing = this.audit.getProposal(proposalId);
    if (!existing) throw new Error(`proposal not found: ${proposalId}`);
    if (existing.status !== "awaiting_human" && existing.status !== "approved") {
      throw new Error(`cannot approve status ${existing.status}`);
    }
    // re-check policy at approval time
    const check = this.policy.check({
      payee: existing.payeeEmail,
      amountCents: existing.amountCents,
      currency: existing.currency,
      reason: existing.reason,
    });
    if (!check.ok) {
      const failed = {
        ...existing,
        status: "guard_rejected" as const,
        guard: { ...existing.guard, allowed: false, policyOk: false, policyReason: check.reason, summary: check.reason },
      };
      await this.audit.saveProposal(failed);
      await this.audit.append({
        type: "fail",
        proposalId,
        detail: `Approve blocked by policy: ${check.reason}`,
      });
      return failed;
    }

    const approved = { ...existing, status: "approved" as const };
    await this.audit.saveProposal(approved);
    await this.audit.append({
      type: "human_approve",
      proposalId,
      detail: "Human approved — executing",
    });
    return this.execute(approved);
  }

  async humanReject(proposalId: string, why = "rejected by human"): Promise<PaymentProposal> {
    const existing = this.audit.getProposal(proposalId);
    if (!existing) throw new Error(`proposal not found: ${proposalId}`);
    const rejected = { ...existing, status: "human_rejected" as const, error: why };
    await this.audit.saveProposal(rejected);
    await this.audit.append({ type: "human_reject", proposalId, detail: why });
    return rejected;
  }

  async execute(proposal: PaymentProposal): Promise<PaymentProposal> {
    try {
      const usePayout = proposal.category === "creator_payout";
      if (usePayout) {
        const payout = await this.adapter.createPayout({
          amountCents: proposal.amountCents,
          currency: proposal.currency,
          receiverEmail: proposal.payeeEmail,
          note: proposal.reason,
          senderItemId: proposal.id,
        });
        this.policy.record(proposal.amountCents);
        const done = {
          ...proposal,
          status: "executed" as const,
          payoutBatchId: payout.batchId,
        };
        await this.audit.saveProposal(done);
        await this.audit.append({
          type: "execute",
          proposalId: proposal.id,
          detail: `Payout ${payout.batchId} (${payout.mode}) ${formatUsd(proposal.amountCents)}`,
          meta: { mode: payout.mode, status: payout.status },
        });
        return done;
      }

      const order = await this.adapter.createOrder({
        amountCents: proposal.amountCents,
        currency: proposal.currency,
        payeeEmail: proposal.payeeEmail,
        description: proposal.reason.slice(0, 127),
        customId: proposal.id,
      });
      const captured = await this.adapter.captureOrder(order.id);
      this.policy.record(proposal.amountCents);
      const done = {
        ...proposal,
        status: "executed" as const,
        orderId: captured.id,
        captureId: captured.captureId,
      };
      await this.audit.saveProposal(done);
      await this.audit.append({
        type: "execute",
        proposalId: proposal.id,
        detail: `Order ${captured.id} capture=${captured.captureId} (${captured.mode}) ${formatUsd(proposal.amountCents)}`,
        meta: { mode: captured.mode, status: captured.status },
      });
      return done;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = { ...proposal, status: "failed" as const, error: message };
      await this.audit.saveProposal(failed);
      await this.audit.append({ type: "fail", proposalId: proposal.id, detail: message });
      return failed;
    }
  }
}
