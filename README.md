# GoalWorld PayGuard

**AI agents that propose, guard, and execute PayPal *sandbox* payments under a human spend policy.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Agentic Commerce angle).  
Team: GoalWorld / TheNeuralWars · Contact: nico@goalworld.fun

> **Honesty:** default mode is an in-memory **mock** PayPal adapter that follows PayPal's real Orders v2 / Payouts state machine. `PAYGUARD_MODE=sandbox` + `vault-run paypal-sandbox` talks to the real `api-m.sandbox.paypal.com` — verified 2026-11-09: OAuth ✓, order create → `PAYER_ACTION_REQUIRED` ✓, early capture → `422 ORDER_NOT_APPROVED` ✓, Payouts batch ✓. Capture after a sandbox **buyer** approval still needs a sandbox personal account (see STATUS). **Live PayPal endpoints are refused.** No real money.

## Why it exists

Agent fleets (Hermes / GoalWorld ops) need to pay creators, tools, and vendors — without a blank check. PayGuard is the policy gate:

1. **Propose (LLM)** — OmniRoute `free-smart` turns a natural-language intent into a structured payment (JSON mode + schema). Code re-imposes the payee/amount the intent literally states.
2. **Guard** — hard spend policy in code (per-tx cap, daily cap incl. held funds, exact-match payee allowlist, reason) **plus** an LLM risk reviewer that can only make the verdict stricter (`block` → `AI_RISK_BLOCK`). Rules are the fallback and the risk floor.
3. **Human** — approve / reject in the Ops UI, with the brakes (caps, spent, held, remaining) on screen.
4. **PayPal** — creator payouts via **Payouts v1**; everything else via **Orders v2**: create → **payer approves on PayPal** → return URL → verify `APPROVED` → capture. Full audit trail.

## Quick start (mock — no credentials)

```bash
npm install
npm test               # 79 tests
npm run typecheck
npm run demo:offline   # rules only, no network
npm run demo:llm       # + OmniRoute free-smart (Goalchain VPS)
npm run smoke:sandbox  # PayPal contract smoke (mock here; sandbox below)
npm run dev            # http://127.0.0.1:3047  (bound to localhost)
```

## Sandbox mode (credentials in Hermes Vault as `paypal-sandbox`)

```bash
PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- npm run smoke:sandbox -- --wait-approval 300
PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- scripts/with-omniroute.sh npm run demo
```

`vault-run` injects `HERMES_VAULT_SECRET=CLIENT_ID:SECRET` (or set `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`).  
`PAYPAL_API_BASE` must be exactly `https://api-m.sandbox.paypal.com` — Live and look-alike hosts are refused. For Orders in sandbox the allowlisted payees must be sandbox business accounts.

Tools & APIs: [TOOLS.md](./TOOLS.md).

## Demo script (jury)

See [DEMO.md](./DEMO.md). 90-second path:

1. Open UI → submit *Pay creator@goalworld.fun $25 for Fractured Code VO polish*.
2. Guard shows policy OK + risk flags → **Approve & execute**.
3. Audit shows payout/order receipt (mock ids or sandbox ids).
4. Orders path: **Open PayPal approval** → payer approves → capture on return.
5. Presets *Over cap*, *Look-alike payee*, *Injection* → `PER_TX_CAP`, `PAYEE_NOT_ALLOWED`, `AI_RISK_BLOCK`.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).

```
Intent → Propose(reasoner) → Guard(policy+risk) → Human → PayPalAdapter → Audit
                                      │
                      mock (default) ─┴─ sandbox Orders v2 / Payouts
```

## Stack

- Next.js 15 + React 19 + TypeScript
- Vitest (policy, adapter, pipeline, sandbox safety rails)
- PayPal REST sandbox (Orders v2, Payouts) behind adapter
- LLM via OmniRoute `free-smart` (OpenAI-compatible, JSON mode, zod), labeled fallback to rules

## Status

Private repo during build. See [STATUS.md](./STATUS.md).  
Not public, not submitted, no production deploy.

## License

MIT — see [LICENSE](./LICENSE).
