import { SpendPolicy } from "./policy/spend-policy";
import { PayPalApiError, type PayPalAdapter, type PayPalOrder } from "./paypal/types";
import { proposePayment } from "./agents/propose";
import { guardProposal } from "./agents/guard";
import type { PaymentIntent, PaymentProposal, Reasoner } from "./agents/types";
import { AuditStore } from "./audit/store";
import { formatUsd } from "./money";
import { canonicalPayee } from "./payee";

export interface PipelineOptions {
  /** Origin used to build PayPal return_url / cancel_url. */
  appBaseUrl?: string;
}

/**
 * Intent → Propose → Guard → Human → PayPal → Audit
 *
 * Execution paths (both mirror real PayPal REST):
 *  - creator_payout → Payouts v1 (merchant-initiated, no payer approval; batch PENDING→SUCCESS)
 *  - everything else → Orders v2 checkout:
 *      create (PAYER_ACTION_REQUIRED + payer-action link) → payer approves on PayPal
 *      → return_url → verify APPROVED + amount/payee unchanged → capture → COMPLETED
 *    Budget is RESERVED while waiting for the payer, committed on capture, released on cancel.
 */
export class PayGuardPipeline {
  private readonly appBaseUrl: string;

  constructor(
    public readonly policy: SpendPolicy,
    public readonly adapter: PayPalAdapter,
    public readonly reasoner: Reasoner,
    public readonly audit: AuditStore,
    opts: PipelineOptions = {},
  ) {
    this.appBaseUrl = (opts.appBaseUrl || "http://127.0.0.1:3047").replace(/\/$/, "");
  }

  async submitIntent(intent: PaymentIntent): Promise<PaymentProposal> {
    let proposal = await proposePayment(intent, this.policy, this.reasoner);
    await this.audit.saveProposal(proposal);
    await this.audit.append({
      type: "propose",
      proposalId: proposal.id,
      detail: `Proposed ${formatUsd(proposal.amountCents)} → ${proposal.payeeEmail}`,
      meta: { reasoner: proposal.proposeTrace, category: proposal.category },
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
        policyCode: proposal.guard.policyCode,
        risk: proposal.guard.riskLevel,
        ai: proposal.guard.aiRecommendation,
        reasoner: proposal.riskTrace,
      },
    });
    return proposal;
  }

  private require(proposalId: string): PaymentProposal {
    const existing = this.audit.getProposal(proposalId);
    if (!existing) throw new Error(`proposal not found: ${proposalId}`);
    return existing;
  }

  private async fail(p: PaymentProposal, message: string, status: PaymentProposal["status"] = "failed") {
    const failed = { ...p, status, error: message };
    await this.audit.saveProposal(failed);
    await this.audit.append({ type: "fail", proposalId: p.id, detail: message });
    return failed;
  }

  async humanApprove(proposalId: string): Promise<PaymentProposal> {
    const existing = this.require(proposalId);
    if (existing.status !== "awaiting_human") {
      throw new Error(`cannot approve status ${existing.status}`);
    }
    // Re-check hard policy at approval time (budget may have moved since propose).
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
        guard: {
          ...existing.guard,
          allowed: false,
          policyOk: false,
          policyReason: check.reason,
          policyCode: check.code,
          summary: `Policy blocked at approval: ${check.reason}`,
        },
      };
      await this.audit.saveProposal(failed);
      await this.audit.append({ type: "fail", proposalId, detail: `Approve blocked by policy: ${check.reason}` });
      return failed;
    }

    const approved = { ...existing, status: "approved" as const };
    await this.audit.saveProposal(approved);
    await this.audit.append({ type: "human_approve", proposalId, detail: "Human approved — executing" });
    return this.execute(approved);
  }

  async humanReject(proposalId: string, why = "rejected by human"): Promise<PaymentProposal> {
    const existing = this.require(proposalId);
    if (existing.status === "executed") throw new Error("cannot reject an executed payment");
    this.policy.release(proposalId);
    const rejected = { ...existing, status: "human_rejected" as const, error: why };
    await this.audit.saveProposal(rejected);
    await this.audit.append({ type: "human_reject", proposalId, detail: why });
    return rejected;
  }

  async execute(proposal: PaymentProposal): Promise<PaymentProposal> {
    if (proposal.status !== "approved") throw new Error(`execute requires approved, got ${proposal.status}`);
    try {
      if (proposal.category === "creator_payout") return await this.executePayout(proposal);
      return await this.createCheckoutOrder(proposal);
    } catch (err) {
      this.policy.release(proposal.id);
      return this.fail(proposal, errMessage(err));
    }
  }

  private async executePayout(proposal: PaymentProposal): Promise<PaymentProposal> {
    const payout = await this.adapter.createPayout({
      amountCents: proposal.amountCents,
      currency: proposal.currency,
      receiverEmail: proposal.payeeEmail,
      note: proposal.reason,
      senderItemId: proposal.id,
    });
    // Payouts debit the merchant balance at submit time → count it now.
    this.policy.record(proposal.amountCents);
    const done = {
      ...proposal,
      status: "executed" as const,
      payoutBatchId: payout.batchId,
      payoutStatus: payout.status,
    };
    await this.audit.saveProposal(done);
    await this.audit.append({
      type: "execute",
      proposalId: proposal.id,
      detail: `Payout ${payout.batchId} (${payout.mode}) ${formatUsd(proposal.amountCents)} batch_status=${payout.status}`,
      meta: { mode: payout.mode, status: payout.status, rail: "payouts" },
    });
    return done;
  }

  private async createCheckoutOrder(proposal: PaymentProposal): Promise<PaymentProposal> {
    this.policy.reserve(proposal.id, proposal.amountCents);
    const q = `proposal=${encodeURIComponent(proposal.id)}`;
    const order = await this.adapter.createOrder({
      amountCents: proposal.amountCents,
      currency: proposal.currency,
      payeeEmail: proposal.payeeEmail,
      description: proposal.reason.slice(0, 127),
      customId: proposal.id,
      returnUrl: `${this.appBaseUrl}/api/paypal/return?${q}`,
      cancelUrl: `${this.appBaseUrl}/api/paypal/cancel?${q}`,
    });
    if (!order.approveUrl) {
      throw new Error(`PayPal order ${order.id} returned no payer-action/approve link (status ${order.status})`);
    }
    const waiting = {
      ...proposal,
      status: "awaiting_payer_approval" as const,
      orderId: order.id,
      orderStatus: order.status,
      approveUrl: order.approveUrl,
    };
    await this.audit.saveProposal(waiting);
    await this.audit.append({
      type: "order_created",
      proposalId: proposal.id,
      detail: `Order ${order.id} (${order.mode}) ${formatUsd(proposal.amountCents)} status=${order.status} — waiting for payer approval; ${formatUsd(proposal.amountCents)} reserved`,
      meta: { mode: order.mode, status: order.status, rail: "orders_v2" },
    });
    return waiting;
  }

  /**
   * PayPal return_url handler. Captures ONLY if PayPal reports APPROVED and the
   * order still matches what the Guard + human approved.
   */
  async completePayerApproval(proposalId: string, token: string): Promise<PaymentProposal> {
    const p = this.require(proposalId);
    if (p.status === "executed") return p; // idempotent browser refresh
    if (p.status !== "awaiting_payer_approval" || !p.orderId) {
      throw new Error(`proposal ${proposalId} is not awaiting payer approval (status ${p.status})`);
    }
    if (token !== p.orderId) {
      throw new Error(`token/order mismatch for ${proposalId}`);
    }

    let order: PayPalOrder = await this.adapter.getOrder(p.orderId);
    if (order.status === "COMPLETED") {
      return this.markCaptured(p, order);
    }
    if (order.status !== "APPROVED") {
      const still = { ...p, orderStatus: order.status, error: `payer has not approved yet (PayPal status ${order.status})` };
      await this.audit.saveProposal(still);
      return still;
    }

    const mismatch = orderMismatch(p, order);
    if (mismatch) {
      this.policy.release(p.id);
      return this.fail(p, `refusing capture — order changed after approval: ${mismatch}`);
    }
    const check = this.policy.check({
      payee: p.payeeEmail,
      amountCents: p.amountCents,
      currency: p.currency,
      reason: p.reason,
      reservationId: p.id,
    });
    if (!check.ok) {
      this.policy.release(p.id);
      return this.fail(p, `capture blocked by policy: ${check.reason}`, "guard_rejected");
    }

    const held = this.policy.reservationOf(p.id);
    await this.audit.append({
      type: "payer_approved",
      proposalId: p.id,
      detail: `PayPal payer approved order ${p.orderId}; verified ${formatUsd(order.amountCents)} ${order.currency} → ${order.payeeEmail || p.payeeEmail} = reservation ${formatUsd(held)} — capturing`,
      meta: {
        paypal: { status: order.status, amountCents: order.amountCents, currency: order.currency, payee: order.payeeEmail },
        proposal: { amountCents: p.amountCents, currency: p.currency, payee: p.payeeEmail },
        reservedCents: held,
        match: held === p.amountCents && !orderMismatch(p, order),
      },
    });
    try {
      order = await this.adapter.captureOrder(p.orderId, p.id);
    } catch (err) {
      if (err instanceof PayPalApiError && err.issue === "ORDER_ALREADY_CAPTURED") {
        order = await this.adapter.getOrder(p.orderId);
      } else {
        this.policy.release(p.id);
        return this.fail(p, errMessage(err));
      }
    }
    if (order.status !== "COMPLETED") {
      this.policy.release(p.id);
      return this.fail(p, `capture did not complete (status ${order.status})`);
    }
    return this.markCaptured(p, order);
  }

  private async markCaptured(p: PaymentProposal, order: PayPalOrder): Promise<PaymentProposal> {
    this.policy.commit(p.id, p.amountCents);
    const done = {
      ...p,
      status: "executed" as const,
      orderStatus: order.status,
      captureId: order.captureId,
      error: undefined,
    };
    await this.audit.saveProposal(done);
    await this.audit.append({
      type: "execute",
      proposalId: p.id,
      detail: `Order ${order.id} captured ${order.captureId} (${order.mode}) ${formatUsd(p.amountCents)} capture_status=${order.captureStatus ?? "?"}`,
      meta: { mode: order.mode, status: order.status, captureId: order.captureId, captureStatus: order.captureStatus, rail: "orders_v2" },
    });
    return done;
  }

  /** PayPal cancel_url handler — payer backed out; release budget, capture nothing. */
  async cancelPayerApproval(proposalId: string, token?: string): Promise<PaymentProposal> {
    const p = this.require(proposalId);
    if (p.status !== "awaiting_payer_approval") return p;
    if (token && token !== p.orderId) throw new Error(`token/order mismatch for ${proposalId}`);
    this.policy.release(p.id);
    const cancelled = { ...p, status: "payer_cancelled" as const, error: "payer cancelled on PayPal" };
    await this.audit.saveProposal(cancelled);
    await this.audit.append({ type: "payer_cancel", proposalId, detail: `Payer cancelled order ${p.orderId}; reservation released` });
    return cancelled;
  }

  async refreshPayout(proposalId: string): Promise<PaymentProposal> {
    const p = this.require(proposalId);
    if (!p.payoutBatchId) throw new Error(`proposal ${proposalId} has no payout batch`);
    const payout = await this.adapter.getPayout(p.payoutBatchId);
    const updated = { ...p, payoutStatus: payout.status };
    await this.audit.saveProposal(updated);
    return updated;
  }

  /** Rebuild today's spend + holds from the persisted audit store (after restart). */
  restoreSpendFromAudit(today = new Date().toISOString().slice(0, 10)): void {
    let spent = 0;
    const holds: Array<[string, number]> = [];
    for (const p of this.audit.listProposals()) {
      if (p.createdAt.slice(0, 10) !== today) continue;
      if (p.status === "executed") spent += p.amountCents;
      if (p.status === "awaiting_payer_approval") holds.push([p.id, p.amountCents]);
    }
    this.policy.restore({ spentCents: spent, reservations: holds });
  }
}

function orderMismatch(p: PaymentProposal, o: PayPalOrder): string | null {
  if (o.amountCents && o.amountCents !== p.amountCents) return `amount ${o.amountCents}¢ ≠ ${p.amountCents}¢`;
  if (o.currency && o.currency !== p.currency) return `currency ${o.currency} ≠ ${p.currency}`;
  if (o.payeeEmail && canonicalPayee(o.payeeEmail) !== canonicalPayee(p.payeeEmail)) {
    return `payee ${o.payeeEmail} ≠ ${p.payeeEmail}`;
  }
  return null;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
