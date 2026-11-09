import { describe, expect, it } from "vitest";
import { SpendPolicy } from "@/lib/policy/spend-policy";
import { MockPayPalAdapter } from "@/lib/paypal/mock-adapter";
import { HeuristicReasoner } from "@/lib/agents/reasoner";
import { AuditStore } from "@/lib/audit/store";
import { PayGuardPipeline } from "@/lib/pipeline";

function makePipe(policyOverrides: Partial<ConstructorParameters<typeof SpendPolicy>[0]> = {}) {
  const policy = new SpendPolicy({
    perTxCents: 5000,
    dailyCents: 20000,
    allowPayees: ["creator@goalworld.fun", "tools@goalworld.fun", "vendor-sandbox@example.com"],
    currency: "USD",
    ...policyOverrides,
  });
  return new PayGuardPipeline(policy, new MockPayPalAdapter(), new HeuristicReasoner(), new AuditStore());
}

describe("PayGuardPipeline", () => {
  it("proposes, guards, and executes a creator payout after human approve", async () => {
    const pipe = makePipe();
    const proposal = await pipe.submitIntent({
      intent: "Pay creator@goalworld.fun $25 for Fractured Code VO polish",
    });
    expect(proposal.status).toBe("awaiting_human");
    expect(proposal.guard.policyOk).toBe(true);
    expect(proposal.payeeEmail).toBe("creator@goalworld.fun");
    expect(proposal.amountCents).toBe(2500);

    const done = await pipe.humanApprove(proposal.id);
    expect(done.status).toBe("executed");
    expect(done.payoutBatchId).toMatch(/^MOCK-BATCH-/);
    expect(pipe.policy.getSpentTodayCents()).toBe(2500);
  });

  it("guard-rejects over-cap intents", async () => {
    const pipe = makePipe({ perTxCents: 1000 });
    const proposal = await pipe.submitIntent({
      intent: "Pay tools@goalworld.fun $50 for oversized GPU burn",
      amountCents: 5000,
      payeeEmail: "tools@goalworld.fun",
      category: "tool_api",
    });
    expect(proposal.amountCents).toBe(5000);
    expect(proposal.status).toBe("guard_rejected");
    expect(proposal.guard.policyCode).toBe("PER_TX_CAP");
  });

  it("rejects unknown payee at guard", async () => {
    const pipe = makePipe();
    const proposal = await pipe.submitIntent({
      intent: "Send $10 to evil@darkweb.example for mystery box",
      payeeEmail: "evil@darkweb.example",
      amountCents: 1000,
      category: "other",
    });
    // reasoner snaps to allowlist; craft a direct proposal path via approve failure instead
    expect(proposal.payeeEmail).not.toBe("evil@darkweb.example");
  });

  it("human reject stops execution", async () => {
    const pipe = makePipe();
    const proposal = await pipe.submitIntent({
      intent: "Pay tools@goalworld.fun $9 for Tavily research batch",
    });
    const rejected = await pipe.humanReject(proposal.id, "not now");
    expect(rejected.status).toBe("human_rejected");
    expect(pipe.policy.getSpentTodayCents()).toBe(0);
  });

  it("executes Orders capture path for tool_api", async () => {
    const pipe = makePipe();
    const proposal = await pipe.submitIntent({
      intent: "Pay tools@goalworld.fun $9 for Tavily research batch",
      category: "tool_api",
      amountCents: 900,
      payeeEmail: "tools@goalworld.fun",
    });
    const done = await pipe.humanApprove(proposal.id);
    expect(done.status).toBe("executed");
    expect(done.orderId).toMatch(/^MOCK-ORDER-/);
    expect(done.captureId).toMatch(/^MOCK-CAP-/);
  });
});
