# Architecture — GoalWorld PayGuard

```
Intent ─▶ Propose (LLM free-smart │ rules fallback)
            │  code re-imposes intent's payee + amount
            ▼
         Guard = SpendPolicy (authoritative, code)  +  Risk (LLM, stricter-only; floor = rules)
            │  guard_rejected ◀── PER_TX_CAP · DAILY_CAP · PAYEE_NOT_ALLOWED · REASON_REQUIRED · AI_RISK_BLOCK
            ▼
         Human approve  (policy re-checked)
            │
            ├─ creator_payout ─▶ Payouts v1 ─▶ batch PENDING → SUCCESS            (spend recorded)
            │
            └─ other ─▶ Orders v2 create ─▶ PAYER_ACTION_REQUIRED + payer-action link   (budget HELD)
                           payer approves on PayPal ─▶ return_url ─▶ GET order == APPROVED?
                           amount/payee unchanged? policy still OK? ─▶ capture ─▶ COMPLETED (hold → spend)
                           payer cancels ─▶ cancel_url ─▶ payer_cancelled             (hold released)
            ▼
         Audit (append-only events + proposal snapshots)
```

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Policy | `src/lib/policy/spend-policy.ts` | Per-tx, daily (spent + held), exact payee allowlist, reason, currency; reserve/commit/release; restore after restart |
| Payee identity | `src/lib/payee.ts` | Strict ASCII email, whole-token extraction (no homoglyph substring snapping) |
| Reasoners | `src/lib/agents/reasoner.ts` | `LlmReasoner` (OmniRoute, JSON mode, zod, timeout) → `HeuristicReasoner` fallback + risk floor |
| Agents | `src/lib/agents/propose.ts`, `guard.ts` | Intent → proposal → verdict (`allowed = policyOk && ai != block`) |
| PayPal port | `src/lib/paypal/*` | `PayPalAdapter` — `MockPayPalAdapter` (same state machine) \| `SandboxPayPalAdapter` |
| Pipeline | `src/lib/pipeline.ts` | Orchestration, payer-approval return/cancel, tamper check, idempotent capture |
| Audit | `src/lib/audit/store.ts` | `data/audit-store.<mode>.json` |
| UI / API | `app/*` | Ops desk with live brakes panel; `/api/policy`, `/api/paypal/return|cancel`, mock checkout |

## Money

Integer USD cents everywhere. Orders send `{value, currency_code}` with `items[]` + `breakdown.item_total`; Payouts send `{value, currency}` (the real sandbox rejected `currency_code` there — caught by the sandbox smoke).

## Failure modes (handled + tested)

| Case | Behavior |
|---|---|
| Unknown / look-alike payee (digit swap, homoglyph, plus-tag, look-alike domain…) | Kept verbatim → Guard `PAYEE_NOT_ALLOWED`; risk forced high. **No snapping.** |
| LLM "fixes" a payee or shrinks an amount | Code override back to the intent's literal value; Guard decides |
| LLM says low risk on an injection | Rules floor keeps it `high`, recommendation `review` |
| LLM says `block` | `guard_rejected / AI_RISK_BLOCK` |
| LLM timeout / 5xx / non-JSON / schema fail | `llm_fallback` with reason; pipeline continues on rules |
| Capture before payer approval | PayPal `422 ORDER_NOT_APPROVED`; we never call capture until GET says `APPROVED` |
| Forged return token / order changed after approval | Refused; hold released |
| Payer cancels | `payer_cancelled`, hold released |
| Slow payers + new spend | Held budget counts against the daily cap |
| Live or look-alike API base | Hard refuse at config + adapter |

## Secrets

`vault-run paypal-sandbox -- …` injects `HERMES_VAULT_SECRET` = `CLIENT_ID:SECRET` (Basic pair), parsed only in sandbox mode. Explicit `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` also work. OmniRoute key comes from env (`scripts/with-omniroute.sh`). Nothing secret is committed, logged or put in argv.
