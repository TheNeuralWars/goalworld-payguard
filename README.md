# GoalWorld PayGuard

**AI agents that propose, guard, and execute PayPal *sandbox* payments under a human spend policy.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Agentic Commerce angle).  
Team: GoalWorld / TheNeuralWars · Contact: nico@goalworld.fun

> **Honesty:** default mode is an in-memory **mock** PayPal adapter. Real sandbox REST (Orders v2 + Payouts) activates only when `PAYGUARD_MODE=sandbox` and credentials arrive via `vault-run paypal-sandbox`. **Live PayPal endpoints are refused.** No real money.

## Why it exists

Agent fleets (Hermes / GoalWorld ops) need to pay creators, tools, and vendors — without a blank check. PayGuard is the policy gate:

1. **Propose** — agent turns a natural-language intent into a structured payment.
2. **Guard** — spend policy (per-tx cap, daily cap, payee allowlist, reason required) + risk flags.
3. **Human** — approve / reject in the Ops UI.
4. **Execute** — PayPal sandbox Orders capture *or* Payouts batch; full audit trail.

## Quick start (mock — no credentials)

```bash
npm install
npm test
npm run demo
npm run dev   # http://127.0.0.1:3047  (bound to localhost)
```

## Sandbox mode (when Nico adds vault creds)

```bash
# one-time: vault-add paypal-sandbox … (CLIENT_ID / CLIENT_SECRET)
PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- npm run demo
PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- npm run dev
```

Required env (provided by vault-run): `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.  
`PAYPAL_API_BASE` must stay on `https://api-m.sandbox.paypal.com`.

## Demo script (jury)

See [DEMO.md](./DEMO.md). 90-second path:

1. Open UI → submit *Pay creator@goalworld.fun $25 for Fractured Code VO polish*.
2. Guard shows policy OK + risk flags → **Approve & execute**.
3. Audit shows payout/order receipt (mock ids or sandbox ids).
4. Submit an oversized `$999` intent → **guard_rejected** (per-tx cap).

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
- Optional OpenAI-compatible LLM reasoner; default = labeled heuristic

## Status

Private repo during build. See [STATUS.md](./STATUS.md).  
Not public, not submitted, no production deploy.

## License

MIT — see [LICENSE](./LICENSE).
