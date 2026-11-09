import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/config";
import { SandboxPayPalAdapter } from "@/lib/paypal/sandbox-adapter";

describe("sandbox safety rails", () => {
  it("defaults to mock mode", () => {
    const cfg = loadConfig({ PAYGUARD_MODE: "mock" });
    expect(cfg.mode).toBe("mock");
    expect(loadConfig({}).mode).toBe("mock");
  });

  it("refuses sandbox mode without credentials", () => {
    expect(() =>
      loadConfig({ PAYGUARD_MODE: "sandbox", PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com" }),
    ).toThrow(/PAYPAL_CLIENT_ID/);
  });

  it("refuses non-sandbox API base", () => {
    expect(() =>
      loadConfig({
        PAYGUARD_MODE: "sandbox",
        PAYPAL_CLIENT_ID: "x",
        PAYPAL_CLIENT_SECRET: "y",
        PAYPAL_API_BASE: "https://api-m.paypal.com",
      }),
    ).toThrow(/non-sandbox/);
  });

  it.each([
    "https://api-m.paypal.com",
    "https://api.paypal.com",
    "https://api-m.sandbox.paypal.com.evil.io",
    "https://sandbox.evil.io/api-m.sandbox.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://user:pw@api-m.sandbox.paypal.com",
  ])("refuses look-alike / live base %s", (base) => {
    expect(() =>
      loadConfig({ PAYGUARD_MODE: "sandbox", PAYPAL_CLIENT_ID: "x", PAYPAL_CLIENT_SECRET: "y", PAYPAL_API_BASE: base }),
    ).toThrow(/non-sandbox/);
    expect(() => new SandboxPayPalAdapter("id", "secret", base)).toThrow(/refuses non-sandbox/);
  });

  it("reads the vault-run pair (HERMES_VAULT_SECRET=CLIENT_ID:SECRET) only in sandbox mode", () => {
    const cfg = loadConfig({ PAYGUARD_MODE: "sandbox", HERMES_VAULT_SECRET: "AbcClientId:shh-secret" });
    expect(cfg.paypalClientId).toBe("AbcClientId");
    expect(cfg.paypalClientSecret).toBe("shh-secret");
    expect(cfg.paypalApiBase).toBe("https://api-m.sandbox.paypal.com");
    expect(loadConfig({ PAYGUARD_MODE: "mock", HERMES_VAULT_SECRET: "a:b" }).paypalClientId).toBeUndefined();
  });

  it("SandboxPayPalAdapter constructor refuses live base", () => {
    expect(() => new SandboxPayPalAdapter("id", "secret", "https://api-m.paypal.com")).toThrow(/refuses non-sandbox/);
  });

  it("LLM key falls back to OMNIROUTE_API_KEY; PAYGUARD_LLM_DISABLED turns it off", () => {
    const cfg = loadConfig({ OMNIROUTE_API_KEY: "k" });
    expect(cfg.llmApiKey).toBe("k");
    expect(cfg.llmBaseUrl).toBe("http://127.0.0.1:20128/v1");
    expect(cfg.llmModel).toBe("free-smart");
    expect(loadConfig({ OMNIROUTE_API_KEY: "k", PAYGUARD_LLM_DISABLED: "1" }).llmDisabled).toBe(true);
  });
});
