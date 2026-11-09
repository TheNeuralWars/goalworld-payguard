import { describe, expect, it } from "vitest";
import { makePipe } from "./helpers";

describe("PayGuardPipeline — Payouts rail", () => {
  it("proposes, guards, and executes a creator payout after human approve", async () => {
    const { pipe } = makePipe();
    const proposal = await pipe.submitIntent({
      intent: "Pay creator@goalworld.fun $25 for Fractured Code VO polish",
    });
    expect(proposal.status).toBe("awaiting_human");
    expect(proposal.guard.policyOk).toBe(true);
    expect(proposal.payeeEmail).toBe("creator@goalworld.fun");
    expect(proposal.amountCents).toBe(2500);
    expect(proposal.reasoner).toBe("heuristic");

    const done = await pipe.humanApprove(proposal.id);
    expect(done.status).toBe("executed");
    expect(done.payoutBatchId).toMatch(/^MOCK-BATCH-/);
    expect(done.payoutStatus).toBe("PENDING");
    expect(pipe.policy.getSpentTodayCents()).toBe(2500);
    expect((await pipe.refreshPayout(proposal.id)).payoutStatus).toBe("SUCCESS");
  });
});

describe("PayGuardPipeline — Orders v2 with payer approval", () => {
  async function toPayerStep() {
    const ctx = makePipe();
    const proposal = await ctx.pipe.submitIntent({
      intent: "Pay tools@goalworld.fun $9 for Tavily research batch",
      category: "tool_api",
    });
    const waiting = await ctx.pipe.humanApprove(proposal.id);
    return { ...ctx, waiting };
  }

  it("human approve creates the order and STOPS at awaiting_payer_approval (no capture)", async () => {
    const { pipe, waiting, adapter } = await toPayerStep();
    expect(waiting.status).toBe("awaiting_payer_approval");
    expect(waiting.orderId).toMatch(/^MOCK-ORDER-/);
    expect(waiting.orderStatus).toBe("PAYER_ACTION_REQUIRED");
    expect(waiting.approveUrl).toContain(`/mock-paypal/checkout?token=${waiting.orderId}`);
    expect(waiting.captureId).toBeUndefined();
    expect((await adapter.getOrder(waiting.orderId!)).status).toBe("PAYER_ACTION_REQUIRED");
    // budget is held, not spent
    expect(pipe.policy.getSpentTodayCents()).toBe(0);
    expect(pipe.policy.getReservedCents()).toBe(900);
    expect(pipe.policy.remainingDailyCents()).toBe(20000 - 900);
  });

  it("return_url before the payer approved does not capture", async () => {
    const { pipe, waiting } = await toPayerStep();
    const still = await pipe.completePayerApproval(waiting.id, waiting.orderId!);
    expect(still.status).toBe("awaiting_payer_approval");
    expect(still.error).toMatch(/not approved yet/);
    expect(pipe.policy.getSpentTodayCents()).toBe(0);
  });

  it("payer approves → return_url captures → executed, hold committed to spend", async () => {
    const { pipe, waiting, adapter } = await toPayerStep();
    await adapter.simulatePayerApproval(waiting.orderId!);
    const done = await pipe.completePayerApproval(waiting.id, waiting.orderId!);
    expect(done.status).toBe("executed");
    expect(done.orderStatus).toBe("COMPLETED");
    expect(done.captureId).toMatch(/^MOCK-CAP-/);
    expect(pipe.policy.getSpentTodayCents()).toBe(900);
    expect(pipe.policy.getReservedCents()).toBe(0);
    // idempotent refresh of the return page
    const again = await pipe.completePayerApproval(waiting.id, waiting.orderId!);
    expect(again.status).toBe("executed");
    expect(pipe.policy.getSpentTodayCents()).toBe(900);
    const types = pipe.audit.listEvents().map((e) => e.type).reverse();
    expect(types).toEqual(["propose", "guard", "human_approve", "order_created", "payer_approved", "execute"]);
  });

  it("rejects a forged return token", async () => {
    const { pipe, waiting, adapter } = await toPayerStep();
    await adapter.simulatePayerApproval(waiting.orderId!);
    await expect(pipe.completePayerApproval(waiting.id, "MOCK-ORDER-FORGED")).rejects.toThrow(/mismatch/);
    expect(pipe.policy.getSpentTodayCents()).toBe(0);
  });

  it("payer cancel releases the hold and captures nothing", async () => {
    const { pipe, waiting } = await toPayerStep();
    const cancelled = await pipe.cancelPayerApproval(waiting.id, waiting.orderId);
    expect(cancelled.status).toBe("payer_cancelled");
    expect(pipe.policy.getReservedCents()).toBe(0);
    expect(pipe.policy.getSpentTodayCents()).toBe(0);
  });

  it("holds count against the daily cap (no overspend while payers are slow)", async () => {
    const { pipe } = makePipe({ dailyCents: 1500 });
    const a = await pipe.submitIntent({ intent: "Pay tools@goalworld.fun $9 for Tavily batch one", category: "tool_api" });
    expect((await pipe.humanApprove(a.id)).status).toBe("awaiting_payer_approval");
    const b = await pipe.submitIntent({ intent: "Pay tools@goalworld.fun $9 for Tavily batch two", category: "tool_api" });
    expect(b.status).toBe("guard_rejected");
    expect(b.guard.policyCode).toBe("DAILY_CAP");
  });

  it("restoreSpendFromAudit rebuilds spend + holds after restart", async () => {
    const { pipe, waiting, adapter } = await toPayerStep();
    const p2 = await pipe.submitIntent({ intent: "Pay creator@goalworld.fun $25 for VO polish pass" });
    await pipe.humanApprove(p2.id);
    pipe.policy.restore({ spentCents: 0, reservations: [] });
    pipe.restoreSpendFromAudit();
    expect(pipe.policy.getSpentTodayCents()).toBe(2500);
    expect(pipe.policy.getReservedCents()).toBe(900);
    void waiting;
    void adapter;
  });
});

describe("PayGuardPipeline — guard + human", () => {
  it("guard-rejects over-cap intents", async () => {
    const { pipe } = makePipe({ perTxCents: 1000 });
    const proposal = await pipe.submitIntent({
      intent: "Pay tools@goalworld.fun $50 for oversized GPU burn",
      amountCents: 5000,
      payeeEmail: "tools@goalworld.fun",
      category: "tool_api",
    });
    expect(proposal.amountCents).toBe(5000);
    expect(proposal.status).toBe("guard_rejected");
    expect(proposal.guard.policyCode).toBe("PER_TX_CAP");
    await expect(pipe.humanApprove(proposal.id)).rejects.toThrow(/cannot approve/);
  });

  it("human reject stops execution", async () => {
    const { pipe } = makePipe();
    const proposal = await pipe.submitIntent({ intent: "Pay tools@goalworld.fun $9 for Tavily research batch" });
    const rejected = await pipe.humanReject(proposal.id, "not now");
    expect(rejected.status).toBe("human_rejected");
    expect(pipe.policy.getSpentTodayCents()).toBe(0);
  });

  it("re-checks policy at approval time", async () => {
    const { pipe } = makePipe({ dailyCents: 3000 });
    const proposal = await pipe.submitIntent({ intent: "Pay creator@goalworld.fun $25 for VO polish pass" });
    expect(proposal.status).toBe("awaiting_human");
    pipe.policy._forceSpent(2000);
    const blocked = await pipe.humanApprove(proposal.id);
    expect(blocked.status).toBe("guard_rejected");
    expect(blocked.guard.policyCode).toBe("DAILY_CAP");
  });
});
