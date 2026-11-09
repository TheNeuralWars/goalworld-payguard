import type { Currency } from "./money";

export type PayGuardMode = "mock" | "sandbox";

export interface PayGuardConfig {
  mode: PayGuardMode;
  paypalApiBase: string;
  paypalClientId?: string;
  paypalClientSecret?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  perTxCents: number;
  dailyCents: number;
  currency: Currency;
  allowPayees: string[];
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`bad int env ${name}`);
  return Math.trunc(n);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PayGuardConfig {
  const mode = (env.PAYGUARD_MODE || "mock").toLowerCase() as PayGuardMode;
  if (mode !== "mock" && mode !== "sandbox") {
    throw new Error(`PAYGUARD_MODE must be mock|sandbox, got ${mode}`);
  }
  const allow = (env.PAYGUARD_ALLOW_PAYEES ||
    "creator@goalworld.fun,tools@goalworld.fun,vendor-sandbox@example.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const cfg: PayGuardConfig = {
    mode,
    paypalApiBase: env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com",
    paypalClientId: env.PAYPAL_CLIENT_ID,
    paypalClientSecret: env.PAYPAL_CLIENT_SECRET,
    llmBaseUrl: env.PAYGUARD_LLM_BASE_URL,
    llmApiKey: env.PAYGUARD_LLM_API_KEY,
    llmModel: env.PAYGUARD_LLM_MODEL || "free-smart",
    perTxCents: intEnv("PAYGUARD_PER_TX_CENTS", 5000),
    dailyCents: intEnv("PAYGUARD_DAILY_CENTS", 20000),
    currency: (env.PAYGUARD_CURRENCY || "USD") as Currency,
    allowPayees: allow,
  };

  if (cfg.mode === "sandbox") {
    if (!cfg.paypalClientId || !cfg.paypalClientSecret) {
      throw new Error(
        "sandbox mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (use: vault-run paypal-sandbox -- …)",
      );
    }
    if (!cfg.paypalApiBase.includes("sandbox")) {
      throw new Error("refusing non-sandbox PAYPAL_API_BASE — live endpoints are blocked");
    }
  }
  return cfg;
}
