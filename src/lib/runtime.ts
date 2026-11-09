import path from "node:path";
import { loadConfig } from "./config";
import { SpendPolicy } from "./policy/spend-policy";
import { createPayPalAdapter } from "./paypal/factory";
import { createReasoner } from "./agents/reasoner";
import { AuditStore } from "./audit/store";
import { PayGuardPipeline } from "./pipeline";

// Kept on globalThis: Next.js may load this module in separate route/page bundles,
// and the mock PayPal state must be shared by all of them in one process.
const g = globalThis as typeof globalThis & { __payguardPipeline?: Promise<PayGuardPipeline> | null };

async function build(): Promise<PayGuardPipeline> {
  const cfg = loadConfig();
  const policy = new SpendPolicy({
    perTxCents: cfg.perTxCents,
    dailyCents: cfg.dailyCents,
    allowPayees: cfg.allowPayees,
    currency: cfg.currency,
    requireReason: true,
  });
  const adapter = createPayPalAdapter(cfg);
  const reasoner = createReasoner(cfg);
  const audit = new AuditStore(
    process.env.PAYGUARD_AUDIT_PATH || path.join(process.cwd(), "data", `audit-store.${cfg.mode}.json`),
  );
  await audit.load();
  if (cfg.mode === "mock") {
    // mock orders live in memory — drop stale holds from a previous process
    await audit.expireDanglingOrders("mock adapter restarted; order no longer exists");
  }
  const pipe = new PayGuardPipeline(policy, adapter, reasoner, audit, { appBaseUrl: cfg.appBaseUrl });
  pipe.restoreSpendFromAudit();
  return pipe;
}

export function getPipeline(): Promise<PayGuardPipeline> {
  if (!g.__payguardPipeline) g.__payguardPipeline = build();
  return g.__payguardPipeline;
}

export function resetPipelineForTests(): void {
  g.__payguardPipeline = null;
}
