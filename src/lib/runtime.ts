import path from "node:path";
import { loadConfig } from "./config";
import { SpendPolicy } from "./policy/spend-policy";
import { createPayPalAdapter } from "./paypal/factory";
import { createReasoner } from "./agents/reasoner";
import { AuditStore } from "./audit/store";
import { PayGuardPipeline } from "./pipeline";

let singleton: PayGuardPipeline | null = null;

export async function getPipeline(): Promise<PayGuardPipeline> {
  if (singleton) return singleton;
  const cfg = loadConfig();
  const policy = new SpendPolicy({
    perTxCents: cfg.perTxCents,
    dailyCents: cfg.dailyCents,
    allowPayees: cfg.allowPayees,
    currency: cfg.currency,
    requireReason: true,
  });
  const adapter = createPayPalAdapter(cfg);
  const reasoner = createReasoner({
    llmBaseUrl: cfg.llmBaseUrl,
    llmApiKey: cfg.llmApiKey,
    llmModel: cfg.llmModel,
  });
  const audit = new AuditStore(
    path.join(process.cwd(), "data", "audit-store.json"),
  );
  await audit.load();
  singleton = new PayGuardPipeline(policy, adapter, reasoner, audit);
  return singleton;
}

export function resetPipelineForTests(): void {
  singleton = null;
}
