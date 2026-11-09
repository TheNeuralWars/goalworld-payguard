import { describe, expect, it } from "vitest";
import { SpendPolicy } from "@/lib/policy/spend-policy";

function policy(overrides: Partial<ConstructorParameters<typeof SpendPolicy>[0]> = {}) {
  return new SpendPolicy({
    perTxCents: 5000,
    dailyCents: 10000,
    allowPayees: ["creator@goalworld.fun", "tools@goalworld.fun"],
    currency: "USD",
    requireReason: true,
    ...overrides,
  });
}

describe("SpendPolicy", () => {
  it("allows an in-cap allowlisted payment", () => {
    const p = policy();
    const r = p.check({
      payee: "creator@goalworld.fun",
      amountCents: 2500,
      currency: "USD",
      reason: "Fractured Code VO polish",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects unknown payee", () => {
    const p = policy();
    const r = p.check({
      payee: "evil@example.com",
      amountCents: 100,
      currency: "USD",
      reason: "should fail",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PAYEE_NOT_ALLOWED");
  });

  it("rejects over per-tx cap", () => {
    const p = policy();
    const r = p.check({
      payee: "tools@goalworld.fun",
      amountCents: 5001,
      currency: "USD",
      reason: "too large for policy",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PER_TX_CAP");
  });

  it("rejects when daily cap would be exceeded", () => {
    const p = policy();
    p._forceSpent(9000);
    const r = p.check({
      payee: "tools@goalworld.fun",
      amountCents: 1500,
      currency: "USD",
      reason: "would exceed daily",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DAILY_CAP");
  });

  it("requires a reason", () => {
    const p = policy();
    const r = p.check({
      payee: "tools@goalworld.fun",
      amountCents: 100,
      currency: "USD",
      reason: "short",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REASON_REQUIRED");
  });

  it("records spend against daily budget", () => {
    const p = policy();
    p.record(3000);
    expect(p.getSpentTodayCents()).toBe(3000);
    expect(p.remainingDailyCents()).toBe(7000);
  });
});
