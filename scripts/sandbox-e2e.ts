/**
 * Full PayGuard E2E on the real PayPal SANDBOX, through the running app (HTTP, same calls as the UI):
 *   propose → guard → human approve → Orders create (held) → sandbox BUYER approves headless
 *   → PayPal redirects to our return_url → app verifies APPROVED + amount/payee vs reservation → capture.
 *
 *   # server (sandbox creds):  PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- next start -p 3050
 *   BASE=http://127.0.0.1:3050 OUT=<dir> vault-run paypal-sandbox-buyer -- npx tsx scripts/sandbox-e2e.ts "<intent>"
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE = (process.env.BASE || "http://127.0.0.1:3050").replace(/\/$/, "");
const OUT = process.env.OUT || "/tmp/payguard-e2e";
const intent = process.argv[2] || "Pay sb-kst3o53817230@business.example.com $9 for Tavily research batch";

type P = Record<string, any>;
const j = async (method: string, p: string, body?: unknown): Promise<any> => {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${p}: ${d.error}`);
  return d;
};

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const t: P = { at: new Date().toISOString(), base: BASE, intent, steps: [] as P[] };
  const step = (name: string, data: P) => {
    t.steps.push({ name, at: new Date().toISOString(), ...data });
    console.log(`• ${name}`, JSON.stringify(data));
  };

  step("health", await j("GET", "/api/health"));
  const { proposal: p0 } = await j("POST", "/api/proposals", { intent, category: "tool_api" });
  step("propose+guard", { id: p0.id, status: p0.status, amountCents: p0.amountCents, payee: p0.payeeEmail, risk: p0.guard.riskLevel, ai: p0.guard.aiRecommendation, propose: p0.proposeTrace, riskReasoner: p0.riskTrace });
  if (p0.status !== "awaiting_human") throw new Error(`guard did not pass: ${p0.status} ${p0.guard.policyCode}`);

  const { proposal: p1 } = await j("POST", `/api/proposals/${p0.id}/approve`);
  const pol1 = (await j("GET", "/api/policy")).policy;
  step("human approve → order created", { status: p1.status, orderId: p1.orderId, orderStatus: p1.orderStatus, approveUrl: p1.approveUrl, reservedCents: pol1.reservedCents, remainingDailyCents: pol1.remainingDailyCents });
  if (p1.status !== "awaiting_payer_approval") throw new Error(`expected awaiting_payer_approval, got ${p1.status}`);

  const early = await j("POST", `/api/proposals/${p0.id}/refresh`);
  step("return_url before payer approval (must not capture)", { status: early.proposal.status, error: early.proposal.error });

  const code: number = await new Promise((resolve) => {
    const c = spawn("node", ["scripts/sandbox-buyer-approve.cjs", p1.approveUrl, OUT], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let log = "";
    c.stdout.on("data", (d) => { log += d; process.stdout.write(d); });
    c.stderr.on("data", (d) => { log += d; process.stderr.write(d); });
    c.on("close", async (n) => { t.approverLog = log.split("\n").filter(Boolean); resolve(n ?? 1); });
  });
  step("sandbox buyer approval (headless)", { exit: code });
  if (code === 3) throw new Error("approver stopped on captcha/2FA — see screenshot");

  let final: P = {};
  for (let i = 0; i < 20; i++) {
    final = (await j("GET", "/api/proposals")).proposals.find((x: P) => x.id === p0.id);
    if (final.status === "executed" || final.status === "failed") break;
    if (final.status === "awaiting_payer_approval") await j("POST", `/api/proposals/${p0.id}/refresh`).catch(() => null);
    await new Promise((r) => setTimeout(r, 3000));
  }
  const pol2 = (await j("GET", "/api/policy")).policy;
  const events = (await j("GET", "/api/audit")).events.filter((e: P) => e.proposalId === p0.id).reverse();
  const verify = events.find((e: P) => e.type === "payer_approved")?.meta ?? null;
  step("after capture", {
    status: final.status,
    orderId: final.orderId,
    orderStatus: final.orderStatus,
    captureId: final.captureId,
    error: final.error ?? null,
    spentTodayCents: pol2.spentTodayCents,
    reservedCents: pol2.reservedCents,
  });
  t.result = {
    ok: final.status === "executed" && final.orderStatus === "COMPLETED" && !!final.captureId && verify?.match === true,
    orderId: final.orderId,
    captureId: final.captureId,
    status: final.orderStatus,
    amountCents: final.amountCents,
    payee: final.payeeEmail,
    verifiedAgainstReservation: verify,
  };
  t.audit = events.map((e: P) => ({ at: e.at, type: e.type, detail: e.detail, meta: e.meta }));
  const f = path.join(OUT, "sandbox-e2e-transcript.json");
  await fs.writeFile(f, JSON.stringify(t, null, 2));
  console.log(`\n${t.result.ok ? "✓ E2E captured" : "✗ E2E not complete"} · transcript → ${f}`);
  if (!t.result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
