# STATUS — GoalWorld PayGuard

- **Contest:** PayPal AI Hackathon (Devpost) — angle: Best Use of Agentic Commerce / PayPal+AI
- **Deadline Rome:** 2026-11-12 21:00
- **Repo:** https://github.com/TheNeuralWars/goalworld-payguard (**private**)
- **VPS path:** `/data/work/goalworld-payguard`
- **Preview:** `http://127.0.0.1:3047` on Goalchain VPS (localhost only — not public)
- **Mode default:** `mock`
- **Sandbox:** wired (`SandboxPayPalAdapter`) — awaiting vault `paypal-sandbox` (`PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`)
- **Tests:** `npm test` (policy, mock adapter, pipeline, sandbox safety rails)
- **Docs:** README, ARCHITECTURE, DEMO, LICENSE (MIT)
- **Touched forbidden assets?** No (`goalchain-agentpay` untouched; Flip `_site_public` untouched)
- **Public / deploy / submit?** **No**

## REVIEW: pending

Awaiting **October** (and Hermes CEO) quality gate per QUALITY_BAR before any public demo URL, repo visibility change, video publish, or Devpost submit.

### Still needed from Nico
1. PayPal Developer **sandbox** app → `vault-add paypal-sandbox` (client id + secret)
2. Explicit OK to make repo **public** + add LICENSE visibility on GitHub About
3. OK to record/publish YouTube demo (&lt;3 min)
4. OK to submit on Devpost (after REVIEW: approved)

### Build target
- plan build-done: **2026-11-11 18:00 Europe/Rome**
- video-done target: 2026-11-12 12:00
- submit buffer: → 21:00
