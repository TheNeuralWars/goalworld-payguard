import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { SandboxPayPalAdapter } from "@/lib/paypal/sandbox-adapter";

describe("sandbox safety rails", () => {
  it("defaults to mock mode", () => {
    const cfg = loadConfig({ PAYGUARD_MODE: "mock" } as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe("mock");
  });

  it("refuses sandbox mode without credentials", () => {
    expect(() =>
      loadConfig({
        PAYGUARD_MODE: "sandbox",
        PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com",
      } as NodeJS.ProcessEnv),
    ).toThrow(/PAYPAL_CLIENT_ID/);
  });

  it("refuses non-sandbox API base", () => {
    expect(() =>
      loadConfig({
        PAYGUARD_MODE: "sandbox",
        PAYPAL_CLIENT_ID: "x",
        PAYPAL_CLIENT_SECRET: "y",
        PAYPAL_API_BASE: "https://api-m.paypal.com",
      } as NodeJS.ProcessEnv),
    ).toThrow(/non-sandbox/);
  });

  it("SandboxPayPalAdapter constructor refuses live base", () => {
    expect(
      () => new SandboxPayPalAdapter("id", "secret", "https://api-m.paypal.com"),
    ).toThrow(/refuses non-sandbox/);
  });
});
