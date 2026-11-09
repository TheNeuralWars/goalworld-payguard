/**
 * Human spend policy for agentic payments (fiat cents).
 * Inspired by GoalChain AgentPay spend-cap ideas — fiat edition, not a fork.
 */

export interface PolicyCheckOk {
  ok: true;
}

export interface PolicyCheckFail {
  ok: false;
  reason: string;
  code:
    | "PAYEE_NOT_ALLOWED"
    | "PER_TX_CAP"
    | "DAILY_CAP"
    | "REASON_REQUIRED"
    | "CURRENCY"
    | "AMOUNT";
}

export type PolicyCheck = PolicyCheckOk | PolicyCheckFail;

export interface SpendPolicyOptions {
  perTxCents: number;
  dailyCents: number;
  allowPayees: string[];
  currency?: string;
  requireReason?: boolean;
  /** injectable clock for tests */
  now?: () => Date;
}

export class SpendPolicy {
  readonly perTxCents: number;
  readonly dailyCents: number;
  readonly allowPayees: Set<string>;
  readonly currency: string;
  readonly requireReason: boolean;
  private spentCents = 0;
  private day: string;
  private readonly now: () => Date;

  constructor(opts: SpendPolicyOptions) {
    this.perTxCents = opts.perTxCents;
    this.dailyCents = opts.dailyCents;
    this.allowPayees = new Set(opts.allowPayees.map((p) => p.toLowerCase()));
    this.currency = opts.currency || "USD";
    this.requireReason = opts.requireReason ?? true;
    this.now = opts.now || (() => new Date());
    this.day = this.today();
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private rollDay(): void {
    const t = this.today();
    if (t !== this.day) {
      this.day = t;
      this.spentCents = 0;
    }
  }

  getSpentTodayCents(): number {
    this.rollDay();
    return this.spentCents;
  }

  remainingDailyCents(): number {
    this.rollDay();
    return Math.max(0, this.dailyCents - this.spentCents);
  }

  check(input: {
    payee: string;
    amountCents: number;
    currency: string;
    reason?: string;
  }): PolicyCheck {
    this.rollDay();
    const payee = input.payee.trim().toLowerCase();
    if (!payee) {
      return { ok: false, code: "PAYEE_NOT_ALLOWED", reason: "payee required" };
    }
    if (!this.allowPayees.has(payee)) {
      return {
        ok: false,
        code: "PAYEE_NOT_ALLOWED",
        reason: `payee ${payee} not on allowlist`,
      };
    }
    if (input.currency !== this.currency) {
      return {
        ok: false,
        code: "CURRENCY",
        reason: `currency ${input.currency} not allowed (want ${this.currency})`,
      };
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return {
        ok: false,
        code: "AMOUNT",
        reason: "amountCents must be a positive integer",
      };
    }
    if (this.requireReason && !(input.reason && input.reason.trim().length >= 8)) {
      return {
        ok: false,
        code: "REASON_REQUIRED",
        reason: "reason required (min 8 chars) — agents must explain why",
      };
    }
    if (input.amountCents > this.perTxCents) {
      return {
        ok: false,
        code: "PER_TX_CAP",
        reason: `exceeds per-tx cap ${this.perTxCents}¢ (got ${input.amountCents}¢)`,
      };
    }
    if (this.spentCents + input.amountCents > this.dailyCents) {
      return {
        ok: false,
        code: "DAILY_CAP",
        reason: `exceeds daily cap ${this.dailyCents}¢ (spent ${this.spentCents}¢ + ${input.amountCents}¢)`,
      };
    }
    return { ok: true };
  }

  record(amountCents: number): void {
    this.rollDay();
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new Error("record: bad amount");
    }
    this.spentCents += amountCents;
  }

  /** Test helper */
  _forceSpent(cents: number): void {
    this.rollDay();
    this.spentCents = cents;
  }
}
