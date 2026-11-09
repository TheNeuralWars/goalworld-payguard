/**
 * CLI demo for judges / Hermes smoke.
 *   npm run demo
 * Sandbox (when vault ready):
 *   PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- npm run demo
 */
import { SpendPolicy } from "../src/lib/policy/spend-policy";
import { createPayPalAdapter } from "../src/lib/paypal/factory";
import { HeuristicReasoner } from "../src/lib/agents/reasoner";
import { AuditStore } from "../src/lib/audit/store";
import { PayGuardPipeline } from "../src/lib/pipeline";
import { loadConfig } from "../src/lib/config";
import { formatUsd } from "../src/lib/money";

async function main() {
  const cfg = loadConfig();
  console.log(`\n══ GoalWorld PayGuard demo (${cfg.mode}) ══\n`);

  const pipe = new PayGuardPipeline(
    new SpendPolicy({
      perTxCents: cfg.perTxCents,
      dailyCents: cfg.dailyCents,
      allowPayees: cfg.allowPayees,
      currency: cfg.currency,
    }),
    createPayPalAdapter(cfg),
    new HeuristicReasoner(),
    new AuditStore(),
  );

  const scenarios = [
    {
      title: "A · Creator payout (in policy)",
      intent: "Pay creator@goalworld.fun $25 for Fractured Code VO polish",
      approve: true,
    },
    {
      title: "B · Tool API order (in policy)",
      intent: "Pay tools@goalworld.fun $9 for Tavily research batch",
      approve: true,
    },
    {
      title: "C · Over per-tx cap (must reject)",
      intent: "Pay tools@goalworld.fun $999 for emergency GPU cluster",
      amountCents: 99900,
      payeeEmail: "tools@goalworld.fun",
      category: "tool_api" as const,
      approve: false,
    },
  ];

  for (const s of scenarios) {
    console.log(`→ ${s.title}`);
    const proposal = await pipe.submitIntent({
      intent: s.intent,
      amountCents: "amountCents" in s ? s.amountCents : undefined,
      payeeEmail: "payeeEmail" in s ? s.payeeEmail : undefined,
      category: "category" in s ? s.category : undefined,
    });
    console.log(
      `  status=${proposal.status} ${formatUsd(proposal.amountCents)} → ${proposal.payeeEmail}`,
    );
    console.log(`  guard: ${proposal.guard.summary}`);
    if (s.approve && proposal.status === "awaiting_human") {
      const done = await pipe.humanApprove(proposal.id);
      console.log(
        `  executed: order=${done.orderId || "—"} payout=${done.payoutBatchId || "—"} capture=${done.captureId || "—"}`,
      );
    } else if (proposal.status === "guard_rejected") {
      console.log("  ✓ correctly blocked by policy");
    } else if (!s.approve && proposal.status === "awaiting_human") {
      await pipe.humanReject(proposal.id, "demo: leave unexecuted");
      console.log("  human rejected (demo)");
    }
    console.log("");
  }

  console.log("Audit tail:");
  for (const e of pipe.audit.listEvents().slice(0, 8)) {
    console.log(`  [${e.type}] ${e.detail}`);
  }
  console.log("\nDone. UI: npm run dev → http://127.0.0.1:3047\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
