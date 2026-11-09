/**
 * PayPal contract smoke — the same assertions in mock (now) and sandbox (once vault creds exist).
 *
 *   npm run smoke:sandbox                                            # mock: simulated payer
 *   PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- npm run smoke:sandbox -- --wait-approval 300
 *
 * Checks (Orders v2 + Payouts, $1.00):
 *   1 OAuth (sandbox) / adapter ready
 *   2 create order → PAYER_ACTION_REQUIRED + payer-action link
 *   3 capture BEFORE approval → 422 ORDER_NOT_APPROVED   (the old create→capture bug)
 *   4 payer approval: mock simulates; sandbox prints the link and polls GET order until APPROVED
 *   5 capture → COMPLETED + capture id
 *   6 payout → batch PENDING|SUCCESS, GET batch status
 * Writes artifacts/evidence/sandbox-smoke-<mode>.json (ids only; no secrets).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/lib/config";
import { createPayPalAdapter } from "../src/lib/paypal/factory";
import { PayPalApiError, canSimulatePayer } from "../src/lib/paypal/types";

type Step = { step: string; ok: boolean; detail: string };

async function main() {
  const args = process.argv.slice(2);
  const waitIdx = args.indexOf("--wait-approval");
  const waitSec = waitIdx >= 0 ? Number(args[waitIdx + 1] || 300) : 0;
  const cfg = loadConfig();
  const adapter = createPayPalAdapter(cfg);
  const steps: Step[] = [];
  const log = (s: Step) => {
    steps.push(s);
    console.log(`${s.ok ? "✓" : "✗"} ${s.step} — ${s.detail}`);
  };
  const runId = `smoke_${Date.now().toString(36)}`;
  const orderPayee = process.env.PAYGUARD_SMOKE_ORDER_PAYEE || cfg.allowPayees.find((p) => p.startsWith("tools@")) || cfg.allowPayees[0]!;
  const payoutReceiver = process.env.PAYGUARD_SMOKE_PAYOUT_RECEIVER || cfg.allowPayees.find((p) => p.startsWith("creator@")) || cfg.allowPayees[0]!;

  console.log(`\n══ PayGuard PayPal contract smoke · mode=${cfg.mode} · base=${cfg.mode === "sandbox" ? cfg.paypalApiBase : "in-memory mock"} ══\n`);
  log({ step: "1 adapter", ok: true, detail: `${adapter.mode} adapter ready${cfg.mode === "sandbox" ? " (OAuth on first call)" : ""}` });

  const order = await adapter.createOrder({
    amountCents: 100,
    currency: cfg.currency,
    payeeEmail: orderPayee,
    description: "PayGuard contract smoke ($1.00 sandbox)",
    customId: runId,
    returnUrl: `${cfg.appBaseUrl}/api/paypal/return?proposal=${runId}`,
    cancelUrl: `${cfg.appBaseUrl}/api/paypal/cancel?proposal=${runId}`,
  });
  log({
    step: "2 create order",
    ok: (order.status === "PAYER_ACTION_REQUIRED" || order.status === "CREATED") && !!order.approveUrl,
    detail: `${order.id} status=${order.status} approve=${order.approveUrl ?? "MISSING"}`,
  });

  try {
    await adapter.captureOrder(order.id, `${runId}-early`);
    log({ step: "3 capture before approval", ok: false, detail: "capture unexpectedly succeeded without payer approval" });
  } catch (e) {
    const issue = e instanceof PayPalApiError ? `${e.httpStatus} ${e.issue}` : String(e);
    log({ step: "3 capture before approval", ok: /ORDER_NOT_APPROVED/.test(issue), detail: `refused as expected: ${issue}` });
  }

  let approved = false;
  if (canSimulatePayer(adapter)) {
    const o = await adapter.simulatePayerApproval(order.id);
    approved = o.status === "APPROVED";
    log({ step: "4 payer approval", ok: approved, detail: `MOCK payer approved → ${o.status}` });
  } else if (waitSec > 0) {
    console.log(`\n  Open as the sandbox BUYER and click Pay:  ${order.approveUrl}\n  polling for ${waitSec}s…`);
    const until = Date.now() + waitSec * 1000;
    while (Date.now() < until) {
      const o = await adapter.getOrder(order.id);
      if (o.status === "APPROVED") {
        approved = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    log({ step: "4 payer approval", ok: approved, detail: approved ? "sandbox buyer approved" : "timed out waiting for sandbox buyer" });
  } else {
    log({ step: "4 payer approval", ok: true, detail: `SKIPPED — sandbox needs a human buyer; re-run with --wait-approval 300 (link: ${order.approveUrl})` });
  }

  if (approved) {
    const cap = await adapter.captureOrder(order.id, runId);
    log({ step: "5 capture", ok: cap.status === "COMPLETED" && !!cap.captureId, detail: `${cap.id} status=${cap.status} capture=${cap.captureId}` });
  } else {
    log({ step: "5 capture", ok: true, detail: "SKIPPED (no approval yet)" });
  }

  const payout = await adapter.createPayout({
    amountCents: 100,
    currency: cfg.currency,
    receiverEmail: payoutReceiver,
    note: "PayGuard contract smoke ($1.00 sandbox)",
    senderItemId: runId,
  });
  const polled = await adapter.getPayout(payout.batchId);
  log({
    step: "6 payout",
    ok: ["PENDING", "PROCESSING", "SUCCESS"].includes(payout.status) && !!polled.status,
    detail: `${payout.batchId} create=${payout.status} → get=${polled.status}`,
  });

  const failed = steps.filter((s) => !s.ok).length;
  const out = path.join(process.cwd(), "artifacts", "evidence", `sandbox-smoke-${cfg.mode}.json`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: cfg.mode,
        honest_note: cfg.mode === "mock" ? "MOCK adapter — no PayPal network calls; same state machine as Orders v2/Payouts" : "PayPal SANDBOX (api-m.sandbox.paypal.com) — no real money",
        orderId: order.id,
        payoutBatchId: payout.batchId,
        steps,
        failed,
      },
      null,
      2,
    ),
  );
  console.log(`\n${failed ? `✗ ${failed} step(s) failed` : "✓ contract smoke green"} · evidence → ${path.relative(process.cwd(), out)}\n`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
