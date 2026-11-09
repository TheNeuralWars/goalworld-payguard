import { canonicalPayee, isAllowlisted, isStrictEmail } from "../payee";

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
  /** Held for Orders awaiting PayPal payer approval — counts against the daily cap. */
  private reserved = new Map<string, number>();
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
      this.reserved.clear();
    }
  }

  getSpentTodayCents(): number {
    this.rollDay();
    return this.spentCents;
  }

  getReservedCents(): number {
    this.rollDay();
    let sum = 0;
    for (const v of this.reserved.values()) sum += v;
    return sum;
  }

  remainingDailyCents(): number {
    this.rollDay();
    return Math.max(0, this.dailyCents - this.spentCents - this.getReservedCents());
  }

  snapshot() {
    return {
      perTxCents: this.perTxCents,
      dailyCents: this.dailyCents,
      spentTodayCents: this.getSpentTodayCents(),
      reservedCents: this.getReservedCents(),
      remainingDailyCents: this.remainingDailyCents(),
      currency: this.currency,
      allowPayees: [...this.allowPayees],
      requireReason: this.requireReason,
      day: this.day,
    };
  }

  check(input: {
    payee: string;
    amountCents: number;
    currency: string;
    reason?: string;
    /** reservation key to exclude from the held total (re-check of an existing hold) */
    reservationId?: string;
  }): PolicyCheck {
    this.rollDay();
    const payee = canonicalPayee(input.payee || "");
    if (!payee) {
      return { ok: false, code: "PAYEE_NOT_ALLOWED", reason: "payee required" };
    }
    if (!isStrictEmail(payee)) {
      return {
        ok: false,
        code: "PAYEE_NOT_ALLOWED",
        reason: `payee ${JSON.stringify(payee)} is not a canonical ASCII email — no fuzzy matching`,
      };
    }
    if (!isAllowlisted(payee, this.allowPayees)) {
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
    const held =
      this.getReservedCents() -
      (input.reservationId ? this.reserved.get(input.reservationId) || 0 : 0);
    if (this.spentCents + held + input.amountCents > this.dailyCents) {
      return {
        ok: false,
        code: "DAILY_CAP",
        reason: `exceeds daily cap ${this.dailyCents}¢ (spent ${this.spentCents}¢ + held ${held}¢ + ${input.amountCents}¢)`,
      };
    }
    return { ok: true };
  }

  /** Hold budget while an Order waits for payer approval. Idempotent per id. */
  reserve(id: string, amountCents: number): void {
    this.rollDay();
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("reserve: bad amount");
    this.reserved.set(id, amountCents);
  }

  release(id: string): void {
    this.rollDay();
    this.reserved.delete(id);
  }

  /** Convert a hold into real spend (after PayPal capture COMPLETED). */
  commit(id: string, amountCents: number): void {
    this.release(id);
    this.record(amountCents);
  }

  /** Rebuild today's counters from the persisted audit store after a restart. */
  restore(state: { spentCents: number; reservations: Array<[string, number]> }): void {
    this.rollDay();
    this.spentCents = state.spentCents;
    this.reserved = new Map(state.reservations);
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
