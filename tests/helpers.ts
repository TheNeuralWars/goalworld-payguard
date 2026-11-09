import { SpendPolicy, type SpendPolicyOptions } from "@/lib/policy/spend-policy";
import { MockPayPalAdapter } from "@/lib/paypal/mock-adapter";
import { HeuristicReasoner } from "@/lib/agents/reasoner";
import { AuditStore } from "@/lib/audit/store";
import { PayGuardPipeline } from "@/lib/pipeline";
import type { Reasoner } from "@/lib/agents/types";

export const ALLOW = ["creator@goalworld.fun", "tools@goalworld.fun", "vendor-sandbox@example.com"];

export function makePipe(
  policyOverrides: Partial<SpendPolicyOptions> = {},
  reasoner: Reasoner = new HeuristicReasoner(),
) {
  const policy = new SpendPolicy({
    perTxCents: 5000,
    dailyCents: 20000,
    allowPayees: ALLOW,
    currency: "USD",
    ...policyOverrides,
  });
  const adapter = new MockPayPalAdapter({ approvalBaseUrl: "http://127.0.0.1:3047" });
  const pipe = new PayGuardPipeline(policy, adapter, reasoner, new AuditStore(), {
    appBaseUrl: "http://127.0.0.1:3047",
  });
  return { pipe, policy, adapter };
}

/** OpenAI-compatible stub: returns queued JSON contents in order; records requests. */
export function stubLlm(contents: Array<string | Error | "hang">) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(url), body, headers: (init?.headers ?? {}) as Record<string, string> });
    const next = contents[Math.min(i++, contents.length - 1)];
    if (next === "hang") {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
    if (next instanceof Error) throw next;
    return new Response(
      JSON.stringify({ model: "stub-model", choices: [{ message: { content: next } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}
