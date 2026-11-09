# TOOLS — what PayGuard uses, and how (Devpost "Built with")

| Tool / API | Used for | Where | Mode |
|---|---|---|---|
| **PayPal OAuth 2.0** (`POST /v1/oauth2/token`, client credentials) | Access token for REST calls | `src/lib/paypal/sandbox-adapter.ts` | sandbox only |
| **PayPal Orders v2** (`POST /v2/checkout/orders`, `GET /v2/checkout/orders/{id}`, `POST …/capture`) | Paying tools / vendors: create order with `payment_source.paypal.experience_context` (return/cancel URL, `PAY_NOW`, `NO_SHIPPING`) → payer approves via the `payer-action` link → our `return_url` verifies `APPROVED` + unchanged amount/payee → capture | `sandbox-adapter.ts`, `pipeline.ts`, `app/api/paypal/{return,cancel}` | sandbox / mock |
| **PayPal Payouts v1** (`POST /v1/payments/payouts`, `GET /v1/payments/payouts/{batch}`) | Agent-initiated creator payouts (merchant → recipient email, no payer approval); batch `PENDING → SUCCESS` polling | `sandbox-adapter.ts`, `pipeline.ts` | sandbox / mock |
| `PayPal-Request-Id` header | Idempotent create / capture / payout (keyed by proposal id) | `sandbox-adapter.ts` | sandbox |
| **LLM via OmniRoute** — combo `free-smart` (OpenAI-compatible `/v1/chat/completions`, JSON mode). Observed serving model on 2026-11-09: `claude-opus-5-5-high` (free tier route) | (1) **Propose agent**: intent → structured draft (payee, cents, category, reason). (2) **Risk agent**: social-engineering / injection / mismatch review with `approve · review · block` | `src/lib/agents/reasoner.ts` | always labeled in UI/audit |
| **zod** | Schema-validate every LLM JSON reply (integer cents, enums) | `reasoner.ts` | — |
| Deterministic rules (`HeuristicReasoner`) | Fallback on LLM timeout / HTTP error / bad JSON / schema fail, and the **risk floor** the LLM can never go below | `reasoner.ts` | labeled `llm_fallback` / `heuristic` |
| **SpendPolicy** (our code) | Hard caps: per-tx, daily (incl. held reservations), exact-match payee allowlist, reason required, currency. **Authoritative — the LLM cannot override it.** | `src/lib/policy/spend-policy.ts` | — |
| Next.js 15 / React 19 / TypeScript | Ops desk UI + REST API | `app/` | — |
| Vitest | 79 contract tests (policy, payee near-misses, LLM fallback/override, PayPal state machine, request shapes) | `tests/` | — |
| Hermes Vault (`vault-run paypal-sandbox`) | Injects sandbox credentials as env at run time (TTL 900 s). Never in git, argv or logs. | `src/lib/config.ts` | sandbox |
| Headless Chrome + puppeteer-core | UI screenshots; attempted guest-card payer approval on sandbox checkout | `scripts/screenshot.sh`, `scripts/sandbox-guest-approve.cjs` | evidence only |

## AI ↔ policy contract (why the AI is safe to give a wallet)

1. **Propose (LLM)** drafts the payment. Code then re-imposes the payee and amount the intent literally states — the LLM can't swap a payee or shrink an amount to fit a cap (`code override` is shown in notes).
2. **SpendPolicy (code)** decides `policyOk`. Nothing the LLM says changes this.
3. **Risk (LLM)** can only make things stricter: raise risk, or `block` (→ `AI_RISK_BLOCK`). Its risk level is `max(llm, rules)`.
4. **Human** clicks approve. **PayPal payer** approves the order. Only then capture.

## Mock vs sandbox (honesty)

- `PAYGUARD_MODE=mock` (default): in-memory adapter with PayPal's real state machine (`PAYER_ACTION_REQUIRED → APPROVED → COMPLETED`, `422 ORDER_NOT_APPROVED` on early capture, `ORDER_ALREADY_CAPTURED`, Payouts `PENDING → SUCCESS`). Payer approval is simulated on a page labeled **MOCK**.
- `PAYGUARD_MODE=sandbox`: real `api-m.sandbox.paypal.com`. Any other host (incl. `api-m.paypal.com` Live and look-alikes) is refused at config and adapter construction.
- Live PayPal is never used. No real money.
