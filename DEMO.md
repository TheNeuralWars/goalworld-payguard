# Demo script — GoalWorld PayGuard (~2–3 min)

**Mode shown:** mock (default). Say out loud: *“Sandbox wiring is live behind vault; today we demo the policy gate on the mock adapter so judges can re-run offline.”*

## Setup

```bash
cd /data/work/goalworld-payguard   # or clone
npm install && npm test && npm run demo
npm run dev   # http://127.0.0.1:3047
```

## Narration beats

1. **Problem (15s)** — Agent fleets can spend. Without a gate they drain the treasury. PayGuard is human policy + AI propose/guard on PayPal.
2. **UI tour (20s)** — Dark ops desk: intent box, proposal queue, audit trail. Badge shows `adapter mock` (or `sandbox`).
3. **Happy path (45s)** — Submit: `Pay creator@goalworld.fun $25 for Fractured Code VO polish`.  
   Show status `awaiting_human`, risk flags, reason. Click **Approve & execute**. Audit: payout batch id.
4. **Failure mode (40s)** — Submit oversized `$999` / force high amount. Show `guard_rejected` / policy reason. *This is the product.*
5. **Architecture (20s)** — Point at README diagram: Propose → Guard → Human → Adapter. Sandbox Orders v2 + Payouts ready via vault.
6. **Close (10s)** — Agentic commerce with brakes. GoalWorld / TheNeuralWars.

## CLI alternative (no browser)

`npm run demo` prints scenarios A/B/C including an over-cap reject.

## Recording notes

- No third-party music; no live PayPal login UI required for mock.
- If sandbox creds exist: repeat one approve and show real `ORDER` id — still sandbox.
- Keep total video **&lt; 3 minutes** for Devpost.
