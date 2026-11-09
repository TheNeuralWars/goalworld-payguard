# STATUS — GoalWorld PayGuard

- **Contest:** PayPal AI Hackathon (Devpost) — angle: Best Use of Agentic Commerce / PayPal+AI
- **Deadline Rome:** 2026-11-12 21:00
- **Repo:** https://github.com/TheNeuralWars/goalworld-payguard (**private**)
- **VPS path:** `/data/work/goalworld-payguard` · **Preview:** `http://127.0.0.1:3047` (localhost only; mock PayPal + LLM)
- **Version:** 0.2.0 (re-review build, 2026-11-09 ~19:35 Europe/Rome)
- **PayPal:** mock default · **real sandbox verified** via `vault-run paypal-sandbox` (Hermes Vault, sandbox only; Live refused)
- **AI:** OmniRoute `free-smart` (served `claude-opus-5-5-high` on 2026-11-09) for Propose + Risk; rules fallback labeled
- **Tests:** `79/79` · `tsc --noEmit` **clean** · `next build` OK · `demo:offline` / `demo:llm` / sandbox demo OK · contract smoke mock 6/6 + sandbox green (steps 4–5 need a buyer)
- **Public / deploy / video / submit?** **No** (none of them)
- **Touched forbidden assets?** No (AgentPay, Flip mp4, Cloudflare tunnels untouched)

## REVIEW: pending (re-review)

Previous: `changes_requested` by October 2026-11-09 ~18:30 Rome (see "History" below). Every item mapped to its fix + evidence:

| # | Review item | Fix | Evidence |
|---|---|---|---|
| **P0-1** | Orders create→capture without payer approval | Orders v2 now: create with `payment_source.paypal.experience_context` (return/cancel URL, `PAY_NOW`, `NO_SHIPPING`) → `PAYER_ACTION_REQUIRED` + `payer-action` link → proposal `awaiting_payer_approval` with **budget held** → `return_url` does `GET order`, requires `APPROVED`, checks amount/payee/currency unchanged, re-checks policy → capture (`PayPal-Request-Id` idempotent, `ORDER_ALREADY_CAPTURED` handled) → `executed`. `cancel_url` → `payer_cancelled`, hold released. Creator payouts stay on **Payouts v1** (no payer approval needed). Mock adapter mirrors PayPal states incl. `422 ORDER_NOT_APPROVED` on early capture and Payouts `PENDING→SUCCESS`; mock approval page is labeled MOCK. **Real sandbox** (vault creds): OAuth ✓, order `9N304432RG246962D` → `PAYER_ACTION_REQUIRED` + sandbox checkout link ✓, early capture → `422 ORDER_NOT_APPROVED` ✓ (proves the old bug), Payouts batch `8R2922DQHNK7L` `PENDING` ✓. Sandbox smoke also caught a real bug the mock hid: Payouts needs `{value, currency}` not `currency_code` — fixed + test. | `evidence/smoke-sandbox-20261109.txt`, `sandbox-smoke-sandbox.json`, `smoke-mock-20261109.txt`, `demo-sandbox-llm-20261109.txt` (full app pipeline on real sandbox: payout `QHKZ2X4NQSW4C`, orders `8UT02589FY354182U`, `6VH88401VV016741A` waiting for buyer), `tests/pipeline.test.ts`, `tests/mock-adapter.test.ts`, `tests/sandbox-adapter.test.ts` |
| **P0-2** | AI is heuristic only | `LlmReasoner` → OmniRoute `http://127.0.0.1:20128/v1`, combo `free-smart`, key from env (`scripts/with-omniroute.sh`, never printed). JSON mode + zod schema, 30 s timeout, any failure → rules with `llm_fallback` + reason. Code re-imposes intent's payee/amount (LLM can't swap payee or shrink amount); policy is authoritative; LLM risk can only raise (`max(llm, rules)`) or **veto** (`AI_RISK_BLOCK`). UI/audit show which brain + model + latency handled each step. | `evidence/demo-llm-20261109.txt` (A–F, `llm(claude-opus-5-5-high, …ms)`; injection → `AI_RISK_BLOCK`), `tests/llm-reasoner.test.ts` (14: timeout/5xx/non-JSON/schema fallback, override, floor, veto, key only in header) |
| **P1-3** | Missing TOOLS.md | `TOOLS.md`: PayPal OAuth / Orders v2 / Payouts v1 / Request-Id, OmniRoute model, zod, policy contract, mock vs sandbox. Linked from README. | `TOOLS.md` |
| **P1-4** | Unknown payee snapped to allowlist | Snapping removed. Explicit payee kept verbatim; only trim+lowercase normalisation; strict ASCII email; whole-token extraction (a Cyrillic `хtools@…` no longer becomes `tools@…`). Guard → `PAYEE_NOT_ALLOWED`, risk forced high. Demo scenario D `creat0r@`. | `tests/payee.test.ts` (23: 13 near-misses — digit swap, dropped/extra letter, plus-tag, dot, look-alike/hyphen/tld domains, 2 homoglyphs — via rules **and** via an LLM that tries to "correct" them) |
| **P1-5** | UI caps/remaining | "The brakes" panel: per-tx cap, daily cap, spent, **held (awaiting payer)**, remaining + meter, exact-match allowlist chips; brain badge; status copy per state; reject box with policy code; empty states; presets for over-cap / look-alike / injection; "Open PayPal approval" + "Check approval". | `evidence/payguard-ui-sandbox.png` (real sandbox ids), `payguard-ui-mock.png` (full flow incl. capture), `payguard-mock-paypal-approval.png` |
| P1-6 | Hosted demo URL | **Not done — needs Nico OK** (unchanged) | — |
| **P2-7** | `tsc` casts | `loadConfig(env: EnvLike)`; tests use plain objects. `tsc --noEmit` exit 0. | `evidence/tsc-20261109.txt` |
| **P2-8** | Orders body 422 risk | `items[]` + `breakdown.item_total`, `reference_id`, `custom_id`, `PayPal-Request-Id` | `tests/sandbox-adapter.test.ts`; real sandbox create OK |
| P2-9 | Screenshots | Headless Chrome on VPS | `evidence/*.png` |
| extra | Hard sandbox guard | Exact-origin allowlist (`api-m.sandbox.paypal.com`); Live, look-alike hosts, `http:`, userinfo URLs refused at config and adapter | `tests/sandbox-guard.test.ts` |

### Still blocked / honest gaps
1. **Capture after a real sandbox buyer approval — not yet shown.** No sandbox *personal* (buyer) account credentials available. Tried headless guest-card checkout on `sandbox.paypal.com` with PayPal test cards (Visa 4032…, Amex 3782…) — PayPal answered "We weren't able to add this card" (`evidence/paypal-sandbox-guest-card-declined.png`). To close it: log in once as the sandbox personal buyer (developer.paypal.com → Testing tools → Sandbox accounts → default `…@personal.example.com`) and run  
   `PAYGUARD_MODE=sandbox PAYGUARD_SMOKE_ORDER_PAYEE=sb-kst3o53817230@business.example.com vault-run paypal-sandbox -- npm run smoke:sandbox -- --wait-approval 300` (open the printed link, Pay) → steps 4–5 go green with a real capture id. Or give Hermes the buyer login via vault and it runs headless.
2. Orders in sandbox need sandbox business accounts as payees; default allowlist emails are demo placeholders (works in mock; sandbox demo used them for Payouts = unclaimed, fine).
3. Public repo, Vercel preview, YouTube, Devpost: **off** until October approves + Nico OKs.

## Still needed from Nico
1. Sandbox **personal buyer** login (or 1 manual Pay click on a link) → real capture evidence
2. OK repo public (after REVIEW: approved) · 3. OK YouTube · 4. OK Devpost submit · 5. (optional) OK Vercel preview

## Build / submit clock (Europe/Rome)
- build-done 2026-11-11 18:00 · video 2026-11-12 12:00 · re-review target 2026-11-12 15:00 · deadline **2026-11-12 21:00**

## History
- 2026-11-09 ~18:30 Rome — October `REVIEW: changes_requested` on `5977aba` (P0: Orders without payer approval; heuristic-only AI. P1: TOOLS.md, unknown-payee snap, UI brakes, hosted URL. P2: tsc casts, Orders body, screenshots). Full note: `artifacts/opportunities/paypal-payguard/OCTOBER_REVIEW_NOTE.md`.
