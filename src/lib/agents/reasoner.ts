import type { PaymentIntent, ProposeContext, Reasoner, RiskLevel } from "./types";

const CATEGORY_DEFAULTS: Record<string, { payee: string; amountCents: number }> = {
  creator_payout: { payee: "creator@goalworld.fun", amountCents: 2500 },
  tool_api: { payee: "tools@goalworld.fun", amountCents: 900 },
  ops_escrow: { payee: "vendor-sandbox@example.com", amountCents: 4000 },
  other: { payee: "tools@goalworld.fun", amountCents: 1000 },
};

function detectCategory(intent: string): string {
  const t = intent.toLowerCase();
  if (/creator|fractured|film|editor|vo\b|voice/.test(t)) return "creator_payout";
  if (/api|tavily|gpu|model|token|openai|inference/.test(t)) return "tool_api";
  if (/escrow|freelance|vendor|contractor|ops/.test(t)) return "ops_escrow";
  return "other";
}

function extractAmountCents(intent: string): number | undefined {
  const m = intent.match(/\$\s*(\d+(?:\.\d{1,2})?)/) || intent.match(/(\d+(?:\.\d{1,2})?)\s*usd/i);
  if (!m) return undefined;
  return Math.round(Number(m[1]) * 100);
}

function extractEmail(intent: string): string | undefined {
  const m = intent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m?.[0]?.toLowerCase();
}

/** Deterministic structured reasoner — always available, honestly labeled. */
export class HeuristicReasoner implements Reasoner {
  readonly kind = "heuristic" as const;

  async propose(intent: PaymentIntent, ctx: ProposeContext) {
    const category = intent.category || detectCategory(intent.intent);
    const defaults = CATEGORY_DEFAULTS[category] || CATEGORY_DEFAULTS.other;
    let payee =
      (intent.payeeEmail || extractEmail(intent.intent) || defaults.payee).toLowerCase();
    if (!ctx.allowPayees.includes(payee) && ctx.allowPayees.length) {
      // snap to first allowlisted if hallucinated payee
      const preferred = ctx.allowPayees.find((p) => p.includes(defaults.payee.split("@")[0]!));
      payee = preferred || ctx.allowPayees[0]!;
    }
    // Keep explicit/extracted amounts intact so Guard can reject over-cap.
    // Only fill defaults when the intent did not specify an amount.
    const specified =
      intent.amountCents ?? extractAmountCents(intent.intent);
    let amountCents = specified ?? defaults.amountCents;
    if (amountCents <= 0) amountCents = Math.min(100, ctx.perTxCents);

    const reason =
      intent.intent.trim().length >= 8
        ? `Agent payment: ${intent.intent.trim()}`.slice(0, 200)
        : `GoalWorld ops payment (${category})`;

    return {
      payeeEmail: payee,
      amountCents,
      currency: intent.currency || ctx.currency,
      reason,
      category,
      notes: `Heuristic propose: category=${category}; capped to policy (perTx=${ctx.perTxCents}¢, remainingDaily=${ctx.remainingDailyCents}¢).`,
    };
  }

  async assessRisk(proposal: {
    payeeEmail: string;
    amountCents: number;
    reason: string;
    intent: string;
  }) {
    const flags: string[] = [];
    let riskLevel: RiskLevel = "low";
    if (proposal.amountCents >= 4000) {
      flags.push("amount_near_per_tx_ceiling");
      riskLevel = "medium";
    }
    if (/urgent|asap|immediately|wire|crypto|off.?book/i.test(proposal.intent + proposal.reason)) {
      flags.push("urgency_or_offbook_language");
      riskLevel = "high";
    }
    if (/refund|chargeback|dispute/i.test(proposal.intent)) {
      flags.push("dispute_language");
      riskLevel = riskLevel === "high" ? "high" : "medium";
    }
    if (!flags.length) flags.push("routine_allowlisted_payee");
    return {
      riskLevel,
      riskFlags: flags,
      summary:
        riskLevel === "high"
          ? "High risk language or pattern — require human approval."
          : riskLevel === "medium"
            ? "Elevated amount or keywords — human should review."
            : "Routine allowlisted payment within typical bounds.",
    };
  }
}

/**
 * Optional OpenAI-compatible reasoner. Falls back to heuristic on any failure.
 * Never sends secrets in prompts.
 */
export class LlmReasoner implements Reasoner {
  readonly kind = "llm" as const;
  private fallback = new HeuristicReasoner();

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  private async chat(system: string, user: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content || null;
    } catch {
      return null;
    }
  }

  async propose(intent: PaymentIntent, ctx: ProposeContext) {
    const content = await this.chat(
      "You are PayGuard Propose for GoalWorld. Reply ONLY JSON: {payeeEmail, amountCents, currency, reason, category, notes}. Payee must be from allowlist. amountCents integer.",
      JSON.stringify({ intent, allowPayees: ctx.allowPayees, perTxCents: ctx.perTxCents, remainingDailyCents: ctx.remainingDailyCents, currency: ctx.currency }),
    );
    if (!content) return this.fallback.propose(intent, ctx);
    try {
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
        payeeEmail: string;
        amountCents: number;
        currency: string;
        reason: string;
        category: string;
        notes: string;
      };
      if (!ctx.allowPayees.includes(parsed.payeeEmail.toLowerCase())) {
        return this.fallback.propose(intent, ctx);
      }
      return {
        ...parsed,
        payeeEmail: parsed.payeeEmail.toLowerCase(),
        amountCents: Math.trunc(parsed.amountCents),
      };
    } catch {
      return this.fallback.propose(intent, ctx);
    }
  }

  async assessRisk(proposal: {
    payeeEmail: string;
    amountCents: number;
    reason: string;
    intent: string;
  }) {
    const content = await this.chat(
      'You are PayGuard Guard risk. Reply ONLY JSON: {"riskLevel":"low|medium|high","riskFlags":[string],"summary":string}',
      JSON.stringify(proposal),
    );
    if (!content) return this.fallback.assessRisk(proposal);
    try {
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      return JSON.parse(content.slice(jsonStart, jsonEnd + 1));
    } catch {
      return this.fallback.assessRisk(proposal);
    }
  }
}

export function createReasoner(env: {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
}): Reasoner {
  if (env.llmBaseUrl && env.llmApiKey) {
    return new LlmReasoner(env.llmBaseUrl, env.llmApiKey, env.llmModel || "free-smart");
  }
  return new HeuristicReasoner();
}
