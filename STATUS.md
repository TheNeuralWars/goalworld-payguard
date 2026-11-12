# STATUS — GoalWorld PayGuard

- **Contest:** PayPal AI Hackathon (Devpost) — angle: Best Use of Agentic Commerce / PayPal+AI
- **Deadline Rome:** 2026-11-12 21:00
- **Repo:** https://github.com/TheNeuralWars/goalworld-payguard (**private**)
- **VPS path:** `/data/work/goalworld-payguard` · **Preview:** `http://127.0.0.1:3047` (localhost only; mock PayPal + LLM)
- **Version:** 0.2.1 (re-review build + real sandbox buyer capture, 2026-11-09 ~20:05 Europe/Rome)
- **PayPal:** mock default · **real sandbox verified** via `vault-run paypal-sandbox` (Hermes Vault, sandbox only; Live refused)
- **AI:** OmniRoute `free-smart` (served `claude-opus-5-5-high` on 2026-11-09) for Propose + Risk; rules fallback labeled
- **Tests:** `79/79` · `tsc --noEmit` **clean** · `next build` OK · `demo:offline` / `demo:llm` / sandbox demo OK · contract smoke mock 6/6 + **sandbox 6/6 with real buyer approval + capture** · full-app sandbox E2E captured
- **Public / deploy / video / submit?** **No** (none of them)
- **Touched forbidden assets?** No (AgentPay, Flip mp4, Cloudflare tunnels untouched)

## REVIEW: pending (video)

- **Demo video ready for October review (2026-11-12 17:12 UTC / 18:12 Rome):**
  - **Path:** `/data/shared-memory/artifacts/opportunities/paypal-payguard/media/payguard_demo_20261112.mp4`
  - **Duration:** 107.4s (01:47, 1080p, 24fps, H.264, 2.8 MB)
  - **SHA256:** `b234b1f5e6fd2ebfb8a56aba518c5d251f80af9e7978775226abd9c0bc2166ea`
  - **Captions:** English burned in (drawtext, DejaVu Sans Bold, bottom bar, 24 remapped timeline cues). No AI voice / TTS.
  - **Secrets hygiene:** Zero credentials on screen. Buyer email masked on login modal (`sb-••••••••••`), password hidden/empty, Chrome "Save password?" bubble disabled via `--password-store=basic --disable-save-password-bubble` and clean profile preferences.
  - **Flow recorded end-to-end on live PayPal Sandbox REST + live PayGuard app:**
    1. Legitimate $9 order to allowlisted payee -> LLM Propose + AI Risk Reviewer -> Human operator Approve -> Order `64695876UK418390A` (`PAYER_ACTION_REQUIRED`, $9 held).
    2. Early capture check refused (PayGuard enforces approval before capture).
    3. Sandbox buyer checkout on `www.sandbox.paypal.com` with sandbox Visa selected.
    4. Capture completed: Order `64695876UK418390A` -> `COMPLETED`, Capture ID `4RJ05364RW941004F`, $9.00 committed.
    5. Brakes update live: Spent $9.00, Held $0.00, Remaining $191.00.
    6. Guard Block (Over Cap): Proposes $999 -> rejected by hard policy `PER_TX_CAP` ($50 limit), no Approve button.
    7. Guard Block (Look-alike Payee): `creat0r@` typo -> rejected by hard policy `PAYEE_NOT_ALLOWED` (zero fuzzy snapping).
    8. AI Risk Veto: Prompt injection asking for $45 gift cards -> blocked by AI Risk Reviewer `AI_RISK_BLOCK` (`risk:high`, `ai:block`).
    9. Full immutable audit trail visible.
  - **Verified review frames:** `/data/shared-memory/artifacts/opportunities/paypal-payguard/media/frames/` (8 frames: `frame_01_intro.png` through `frame_08_block_ai_injection.png`, verified via vision for legibility and zero credential leakage).


Previous: `changes_requested` by October 2026-11-09 ~18:30 Rome (see "History" below). Every item mapped to its fix + evidence:

| # | Review item | Fix | Evidence |
|---|---|---|---|
| **P0-1** ✅ **closed** | Orders create→capture without payer approval | **Closed with a real sandbox buyer (2026-11-09 ~20:00 Rome):** full app E2E — propose (LLM) → guard → human approve → order `6DM53573YL891100F` `PAYER_ACTION_REQUIRED`, $9.00 held → return_url before approval refused (no capture) → sandbox buyer `…@personal.example.com` logs in headless on `www.sandbox.paypal.com` only (no captcha/2FA; non-sandbox paypal hosts aborted; password never in screenshots) → PayPal redirects to our `return_url` → app `GET order` = `APPROVED`, verifies **$9.00 USD → sb-kst3o53817230@business.example.com = reservation $9.00** (`match: true`) → capture **`7AU11689AT477705H` `COMPLETED`** → reservation committed (spent $9, held $0). Contract smoke too: order `6L720112KR767970C` → early capture 422 → buyer approved → capture `6NV259828E280613B` `COMPLETED`. Design: Orders v2 now: create with `payment_source.paypal.experience_context` (return/cancel URL, `PAY_NOW`, `NO_SHIPPING`) → `PAYER_ACTION_REQUIRED` + `payer-action` link → proposal `awaiting_payer_approval` with **budget held** → `return_url` does `GET order`, requires `APPROVED`, checks amount/payee/currency unchanged, re-checks policy → capture (`PayPal-Request-Id` idempotent, `ORDER_ALREADY_CAPTURED` handled) → `executed`. `cancel_url` → `payer_cancelled`, hold released. Creator payouts stay on **Payouts v1** (no payer approval needed). Mock adapter mirrors PayPal states incl. `422 ORDER_NOT_APPROVED` on early capture and Payouts `PENDING→SUCCESS`; mock approval page is labeled MOCK. **Real sandbox** (vault creds): OAuth ✓, order `9N304432RG246962D` → `PAYER_ACTION_REQUIRED` + sandbox checkout link ✓, early capture → `422 ORDER_NOT_APPROVED` ✓ (proves the old bug), Payouts batch `8R2922DQHNK7L` `PENDING` ✓. Sandbox smoke also caught a real bug the mock hid: Payouts needs `{value, currency}` not `currency_code` — fixed + test. | **`evidence/buyer-approval-e2e/`** (`sandbox-e2e-transcript.json`, `paypal-sandbox-buyer-review-post-login.png`, `payguard-ui-after-sandbox-capture.png`, `policy-after-capture.json`, `e2e.log`), **`evidence/buyer-approval-smoke/`** (`smoke-sandbox-wait-approval.txt`, `sandbox-smoke-sandbox.json`, `approver.log`), `scripts/sandbox-e2e.ts`, `scripts/sandbox-buyer-approve.cjs`, `evidence/smoke-sandbox-20261109.txt`, `sandbox-smoke-sandbox.json`, `smoke-mock-20261109.txt`, `demo-sandbox-llm-20261109.txt` (full app pipeline on real sandbox: payout `QHKZ2X4NQSW4C`, orders `8UT02589FY354182U`, `6VH88401VV016741A` waiting for buyer), `tests/pipeline.test.ts`, `tests/mock-adapter.test.ts`, `tests/sandbox-adapter.test.ts` |
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
1. ~~Capture after a real sandbox buyer approval~~ — **closed 2026-11-09** (see P0-1). Buyer login lives only in Hermes Vault `paypal-sandbox-buyer`. Rerun: server `vault-run paypal-sandbox -- env PAYGUARD_MODE=sandbox PAYGUARD_APP_BASE_URL=http://127.0.0.1:3050 PAYGUARD_ALLOW_PAYEES=…,sb-kst3o53817230@business.example.com scripts/with-omniroute.sh npx next start -p 3050`, then `vault-run paypal-sandbox-buyer -- env BASE=http://127.0.0.1:3050 OUT=<dir> NODE_PATH=<puppeteer-core> npx tsx scripts/sandbox-e2e.ts`. Note: sandbox buyer's default funding is a fake bank (SEPA mandate); approver picks the sandbox Visa.
2. Orders in sandbox need sandbox business accounts as payees; default allowlist emails are demo placeholders (works in mock; sandbox demo used them for Payouts = unclaimed, fine).
3. Public repo, Vercel preview, YouTube, Devpost: **off** until October approves + Nico OKs.

## Still needed from Nico
1. ~~Sandbox buyer login~~ ✅ done · 2. OK repo public (after REVIEW: approved) · 3. OK YouTube · 4. OK Devpost submit · 5. (optional) OK Vercel preview

## Build / submit clock (Europe/Rome)
- build-done 2026-11-11 18:00 · video 2026-11-12 12:00 · re-review target 2026-11-12 15:00 · deadline **2026-11-12 21:00**

## History
- 2026-11-09 ~20:00 Rome — P0-1 fully closed with real sandbox buyer approval + capture (`7AU11689AT477705H` COMPLETED via app; `6NV259828E280613B` via smoke). REVIEW stays pending.
- 2026-11-09 ~18:30 Rome — October `REVIEW: changes_requested` on `5977aba` (P0: Orders without payer approval; heuristic-only AI. P1: TOOLS.md, unknown-payee snap, UI brakes, hosted URL. P2: tsc casts, Orders body, screenshots). Full note: `artifacts/opportunities/paypal-payguard/OCTOBER_REVIEW_NOTE.md`.
