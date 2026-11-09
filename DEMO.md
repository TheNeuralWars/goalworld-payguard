# Demo script — GoalWorld PayGuard (~2–3 min)

**Mode shown:** PayPal mock (default, same state machine as PayPal) with the **real LLM** (`brain: LLM · free-smart` badge). Sandbox cut: `PAYGUARD_MODE=sandbox vault-run paypal-sandbox -- …` shows real sandbox order ids and the real `sandbox.paypal.com` approval page. Say out loud which one is on screen.

## Setup

```bash
cd /data/work/goalworld-payguard   # or clone
npm install && npm test && npm run demo
npm run dev   # http://127.0.0.1:3047
```

## Narration beats

1. **Problem (15s)** — Agent fleets can spend. Without a gate they drain the treasury. PayGuard is human policy + AI propose/guard on PayPal.
2. **UI tour (20s)** — Dark ops desk: intent box, proposal queue, audit trail. Badge shows `adapter mock` (or `sandbox`).
3. **Brakes (15s)** — top panel: per-tx cap, daily cap, spent, held, remaining, exact-match allowlist. *The LLM can't change these.*
4. **Happy path — payout (25s)** — preset *Creator payout*. Card shows `propose: LLM claude-opus-5-5-high · risk: LLM`. **Approve & execute** → Payouts batch `PENDING`.
5. **Happy path — order with payer approval (35s)** — preset *Tool order*. Approve → `awaiting_payer_approval`, budget **held**. **Open PayPal approval** → Pay Now → back on return URL → captured. Mention: capturing before approval is a PayPal 422 — we never do it.
6. **Failure modes (40s)** — *Over cap* → `PER_TX_CAP`. *Look-alike payee* `creat0r@` → `PAYEE_NOT_ALLOWED` (no fuzzy snap). *Injection* (“ignore previous policy… gift cards”) → LLM risk veto `AI_RISK_BLOCK`. *This is the product.*
7. **Architecture (15s)** — ARCHITECTURE diagram: LLM proposes, code decides, LLM can only veto, human + PayPal payer approve.
6. **Close (10s)** — Agentic commerce with brakes. GoalWorld / TheNeuralWars.

## CLI alternative (no browser)

`npm run demo:llm` prints scenarios A–F (payout, order + payer approval, over-cap, look-alike payee, injection, payer cancel) with which brain handled each step. `--json <file>` writes evidence.

## Recording notes

- No third-party music; no live PayPal login UI required for mock.
- Sandbox: real order ids + real sandbox checkout page. Capture-after-approval on camera needs a sandbox personal buyer login.
- Keep total video **&lt; 3 minutes** for Devpost.
