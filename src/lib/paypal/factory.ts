import type { PayGuardConfig } from "../config";
import type { PayPalAdapter } from "./types";
import { MockPayPalAdapter } from "./mock-adapter";
import { SandboxPayPalAdapter } from "./sandbox-adapter";

export function createPayPalAdapter(cfg: PayGuardConfig): PayPalAdapter {
  if (cfg.mode === "mock") return new MockPayPalAdapter();
  return new SandboxPayPalAdapter(
    cfg.paypalClientId!,
    cfg.paypalClientSecret!,
    cfg.paypalApiBase,
  );
}
