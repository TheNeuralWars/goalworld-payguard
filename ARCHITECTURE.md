# Architecture — GoalWorld PayGuard

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Policy | `src/lib/policy/spend-policy.ts` | Human caps: per-tx, daily, payee allowlist, reason, currency |
| Reasoner | `src/lib/agents/reasoner.ts` | Propose + risk assess (`heuristic` default, optional LLM) |
| Agents | `src/lib/agents/propose.ts`, `guard.ts` | Turn intent → proposal → verdict |
| PayPal port | `src/lib/paypal/*` | `PayPalAdapter` — `MockPayPalAdapter` \| `SandboxPayPalAdapter` |
| Pipeline | `src/lib/pipeline.ts` | Orchestrates propose→guard→approve→execute + policy.record |
| Audit | `src/lib/audit/store.ts` | Append-only events + proposal snapshots (`data/audit-store.json`) |
| UI / API | `app/*` | Cinematic ops desk + REST for queue/audit |

## Money

All amounts are **integer USD cents**. No floating point in policy or adapters.

## PayPal adapter contract

```ts
createOrder → captureOrder → getOrder
createPayout
```

- **mock:** deterministic ids `MOCK-ORDER-*`, `MOCK-CAP-*`, `MOCK-BATCH-*`.
- **sandbox:** OAuth2 client-credentials against `api-m.sandbox.paypal.com` only.  
  Constructor + `loadConfig` **throw** if API base is not sandbox.

## Failure modes (handled)

| Case | Behavior |
|---|---|
| Unknown payee | Guard `PAYEE_NOT_ALLOWED` (reasoner also snaps to allowlist on propose) |
| Over per-tx / daily | Guard reject; approve re-checks before execute |
| Missing reason | Guard `REASON_REQUIRED` |
| Adapter/HTTP error | Proposal `failed` + audit `fail` |
| Live API base | Hard refuse at config/adapter boot |
| LLM timeout/4xx | Fall back to heuristic reasoner |

## Security / QUALITY_BAR notes

- No secrets in repo; `.env.example` only.
- Localhost bind (`127.0.0.1:3047`) for VPS preview.
- Sandbox credentials via Hermes `vault-run paypal-sandbox`.
- Does **not** modify `goalchain-agentpay` (crypto HashKey pack) — fiat patterns only.
- Does **not** touch GoalChain `_site_public` / Flip demo video.

## Optional LLM

Set `PAYGUARD_LLM_BASE_URL` + `PAYGUARD_LLM_API_KEY` for OpenAI-compatible propose/risk.  
Without them the UI labels `reasoner: heuristic` — honest for judges.
