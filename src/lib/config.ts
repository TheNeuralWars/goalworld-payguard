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
  llmTimeoutMs: number;
  /** Disable the LLM even if a key is present (offline judge re-runs). */
  llmDisabled: boolean;
  /** Public origin of this app — used for PayPal return_url / cancel_url. */
  appBaseUrl: string;
  perTxCents: number;
  dailyCents: number;
  currency: Currency;
  allowPayees: string[];
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

function intEnv(env: EnvLike, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`bad int env ${name}`);
  return Math.trunc(n);
}

/** The only PayPal REST hosts PayGuard will ever talk to. Live (api-m.paypal.com) is refused. */
export const SANDBOX_API_BASES = ["https://api-m.sandbox.paypal.com", "https://api.sandbox.paypal.com"] as const;

export function assertSandboxBase(base: string): void {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error("refusing non-sandbox PAYPAL_API_BASE — not a URL");
  }
  const origin = `${u.protocol}//${u.host}`;
  if (!(SANDBOX_API_BASES as readonly string[]).includes(origin) || u.username || u.password) {
    throw new Error(`refusing non-sandbox PAYPAL_API_BASE ${origin} — live endpoints are blocked`);
  }
}

/**
 * Credentials come from `vault-run paypal-sandbox -- …`. Hermes Vault brokers a custom
 * service as a single HERMES_VAULT_SECRET holding the Basic-auth pair "CLIENT_ID:SECRET";
 * explicit PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET win if set.
 */
function sandboxCreds(env: EnvLike): { id?: string; secret?: string } {
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) {
    return { id: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET };
  }
  const pair = env.PAYPAL_SANDBOX_CREDENTIALS || env.HERMES_VAULT_SECRET;
  if (pair && pair.includes(":")) {
    const i = pair.indexOf(":");
    return { id: pair.slice(0, i).trim(), secret: pair.slice(i + 1).trim() };
  }
  return { id: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET };
}

export function loadConfig(env: EnvLike = process.env): PayGuardConfig {
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
    paypalApiBase: (env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com").replace(/\/$/, ""),
    paypalClientId: mode === "sandbox" ? sandboxCreds(env).id : undefined,
    paypalClientSecret: mode === "sandbox" ? sandboxCreds(env).secret : undefined,
    // OmniRoute (OpenAI-compatible) on the Goalchain VPS; key comes from env, never from code.
    llmBaseUrl: env.PAYGUARD_LLM_BASE_URL || "http://127.0.0.1:20128/v1",
    llmApiKey: env.PAYGUARD_LLM_API_KEY || env.OMNIROUTE_API_KEY,
    llmModel: env.PAYGUARD_LLM_MODEL || "free-smart",
    llmTimeoutMs: intEnv(env, "PAYGUARD_LLM_TIMEOUT_MS", 30_000),
    llmDisabled: /^(1|true|yes)$/i.test(env.PAYGUARD_LLM_DISABLED || ""),
    appBaseUrl: (env.PAYGUARD_APP_BASE_URL || "http://127.0.0.1:3047").replace(/\/$/, ""),
    perTxCents: intEnv(env, "PAYGUARD_PER_TX_CENTS", 5000),
    dailyCents: intEnv(env, "PAYGUARD_DAILY_CENTS", 20000),
    currency: (env.PAYGUARD_CURRENCY || "USD") as Currency,
    allowPayees: allow,
  };

  if (cfg.mode === "sandbox") {
    if (!cfg.paypalClientId || !cfg.paypalClientSecret) {
      throw new Error(
        "sandbox mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (use: vault-run paypal-sandbox -- …)",
      );
    }
    assertSandboxBase(cfg.paypalApiBase);
  }
  return cfg;
}
