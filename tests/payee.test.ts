import { describe, expect, it } from "vitest";
import { extractPayeeToken, isAllowlisted } from "@/lib/payee";
import { LlmReasoner } from "@/lib/agents/reasoner";
import { ALLOW, makePipe, stubLlm } from "./helpers";

/**
 * October P1: unknown payees must NOT be snapped onto the allowlist.
 * Each near-miss must reach the Guard verbatim and be rejected with PAYEE_NOT_ALLOWED.
 */
const NEAR_MISSES: Array<[string, string]> = [
  ["digit-for-letter", "creat0r@goalworld.fun"],
  ["dropped letter", "creatr@goalworld.fun"],
  ["extra letter", "creatorr@goalworld.fun"],
  ["plus-tag", "tools+ops@goalworld.fun"],
  ["sub-local dot", "too.ls@goalworld.fun"],
  ["look-alike domain", "tools@goalworld.fun.evil.io"],
  ["hyphen domain", "tools@goalworld-fun.com"],
  ["tld swap", "tools@goalworld.fan"],
  ["truncated tld", "creator@goalworld.fu"],
  ["cyrillic homoglyph а", "creаtor@goalworld.fun"],
  ["cyrillic prefix х (substring would be allowlisted)", "хtools@goalworld.fun"],
  ["vendor domain swap", "vendor-sandbox@example.co"],
  ["totally unknown", "evil@darkweb.example"],
];

describe("payee identity helpers", () => {
  it("extracts the whole token, never an allowlisted substring", () => {
    expect(extractPayeeToken("Pay хtools@goalworld.fun $9 now")).toBe("хtools@goalworld.fun");
    expect(extractPayeeToken("Pay <tools@goalworld.fun>, thanks")).toBe("tools@goalworld.fun");
    expect(extractPayeeToken("Send to tools@goalworld.fun.")).toBe("tools@goalworld.fun");
    expect(extractPayeeToken("no email here")).toBeUndefined();
  });

  it("only exact (trim + ASCII lowercase) matches are allowlisted", () => {
    expect(isAllowlisted("  Tools@GoalWorld.FUN ", ALLOW)).toBe(true);
    for (const [, email] of NEAR_MISSES) expect(isAllowlisted(email, ALLOW)).toBe(false);
  });
});

describe("Guard rejects near-miss payees (heuristic reasoner, free text)", () => {
  it.each(NEAR_MISSES)("%s: %s", async (_label, email) => {
    const { pipe } = makePipe();
    const p = await pipe.submitIntent({ intent: `Pay ${email} $20 for VO polish`, category: "creator_payout" });
    expect(p.payeeEmail).toBe(email.toLowerCase());
    expect(p.status).toBe("guard_rejected");
    expect(p.guard.policyCode).toBe("PAYEE_NOT_ALLOWED");
    expect(p.guard.riskFlags).toContain("payee_not_allowlisted");
    await expect(pipe.humanApprove(p.id)).rejects.toThrow(/cannot approve/);
  });

  it("explicit payeeEmail field is not snapped either", async () => {
    const { pipe } = makePipe();
    const p = await pipe.submitIntent({
      intent: "Send $10 for mystery box",
      payeeEmail: "evil@darkweb.example",
      amountCents: 1000,
      category: "other",
    });
    expect(p.payeeEmail).toBe("evil@darkweb.example");
    expect(p.status).toBe("guard_rejected");
    expect(p.guard.policyCode).toBe("PAYEE_NOT_ALLOWED");
  });

  it("no payee named → category default (allowlisted) is fine", async () => {
    const { pipe } = makePipe();
    const p = await pipe.submitIntent({ intent: "Tavily research batch for the week", category: "tool_api" });
    expect(p.payeeEmail).toBe("tools@goalworld.fun");
    expect(p.status).toBe("awaiting_human");
  });
});

describe("Guard rejects near-miss payees even when the LLM tries to 'fix' them", () => {
  it.each(NEAR_MISSES.slice(0, 6))("%s: %s", async (_label, email) => {
    // A helpful-but-wrong LLM snaps the payee onto the allowlist.
    const { fetchImpl } = stubLlm([
      JSON.stringify({ payeeEmail: "creator@goalworld.fun", amountCents: 2000, currency: "USD", category: "creator_payout", reason: "VO polish for Fractured Code", notes: "corrected typo" }),
      JSON.stringify({ riskLevel: "low", riskFlags: ["routine"], summary: "Looks fine.", recommendation: "approve" }),
    ]);
    const llm = new LlmReasoner({ baseUrl: "http://stub/v1", apiKey: "k", model: "free-smart", fetchImpl });
    const { pipe } = makePipe({}, llm);
    const p = await pipe.submitIntent({ intent: `Pay ${email} $20 for VO polish` });
    expect(p.payeeEmail).toBe(email.toLowerCase());
    expect(p.proposeNotes).toMatch(/code override: payee/);
    expect(p.status).toBe("guard_rejected");
    expect(p.guard.policyCode).toBe("PAYEE_NOT_ALLOWED");
    expect(p.guard.riskLevel).toBe("high");
  });
});
