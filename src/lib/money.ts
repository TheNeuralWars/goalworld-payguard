/** Fiat amounts in integer USD cents — never floats for money. */

export type Currency = "USD";

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function parseUsdToCents(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid USD amount: ${input}`);
  return Math.round(n * 100);
}

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`amount must be non-negative integer cents, got ${cents}`);
  }
}
