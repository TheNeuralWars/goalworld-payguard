"use client";

import { useCallback, useEffect, useState } from "react";

type Proposal = {
  id: string;
  createdAt: string;
  intent: string;
  payeeEmail: string;
  amountCents: number;
  currency: string;
  reason: string;
  category: string;
  status: string;
  proposeNotes: string;
  guard: {
    allowed: boolean;
    policyOk: boolean;
    policyReason?: string;
    riskLevel: string;
    riskFlags: string[];
    summary: string;
    requiresHuman: boolean;
  };
  orderId?: string;
  captureId?: string;
  payoutBatchId?: string;
  error?: string;
  reasoner: string;
};

type AuditEvent = {
  id: string;
  at: string;
  type: string;
  proposalId: string;
  detail: string;
};

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function HomePage() {
  const [intent, setIntent] = useState(
    "Pay creator@goalworld.fun $25 for Fractured Code VO polish",
  );
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [mode, setMode] = useState("mock");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [p, a, h] = await Promise.all([
      fetch("/api/proposals").then((r) => r.json()),
      fetch("/api/audit").then((r) => r.json()),
      fetch("/api/health").then((r) => r.json()),
    ]);
    setProposals(p.proposals || []);
    setEvents(a.events || []);
    setMode(h.mode || "mock");
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "propose failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || action + " failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="hero">
        <div>
          <h1>GoalWorld PayGuard</h1>
          <p>
            AI agents propose payments. A human spend policy guards them. Execution hits
            PayPal <strong style={{ color: "var(--accent)" }}>sandbox</strong> only —
            never live money.
          </p>
        </div>
        <div className="badge">
          adapter <strong>{mode}</strong>
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <h2>1 · Agent intent</h2>
          <label htmlFor="intent">What should the fleet pay for?</label>
          <textarea
            id="intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Pay tools@goalworld.fun $9 for Tavily research batch"
          />
          <div className="row">
            <button disabled={busy || !intent.trim()} onClick={submit}>
              Propose → Guard
            </button>
            <button className="secondary" disabled={busy} onClick={() => refresh()}>
              Refresh
            </button>
          </div>
          {error ? <p style={{ color: "var(--bad)" }}>{error}</p> : null}

          <h2 style={{ marginTop: 24 }}>2 · Proposal queue</h2>
          <div className="list">
            {proposals.length === 0 ? (
              <p className="mono">No proposals yet — submit an intent.</p>
            ) : (
              proposals.map((p) => (
                <article key={p.id} className="item">
                  <header>
                    <span className={`status ${p.status}`}>{p.status}</span>
                    <span className="mono">{usd(p.amountCents)} → {p.payeeEmail}</span>
                  </header>
                  <div className="mono">{p.id} · {p.category} · {p.reasoner}</div>
                  <p style={{ margin: "8px 0", lineHeight: 1.4 }}>{p.intent}</p>
                  <p className="mono">{p.guard.summary}</p>
                  <div className="flags">
                    <span className="flag">risk:{p.guard.riskLevel}</span>
                    {p.guard.riskFlags.map((f) => (
                      <span className="flag" key={f}>
                        {f}
                      </span>
                    ))}
                  </div>
                  {p.orderId ? (
                    <div className="mono">order {p.orderId} · capture {p.captureId}</div>
                  ) : null}
                  {p.payoutBatchId ? (
                    <div className="mono">payout batch {p.payoutBatchId}</div>
                  ) : null}
                  {p.error ? <div style={{ color: "var(--bad)" }}>{p.error}</div> : null}
                  {p.status === "awaiting_human" ? (
                    <div className="row">
                      <button disabled={busy} onClick={() => act(p.id, "approve")}>
                        Approve & execute
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => act(p.id, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <h2>3 · Audit trail</h2>
          <div className="list">
            {events.length === 0 ? (
              <p className="mono">Empty — actions appear here.</p>
            ) : (
              events.map((e) => (
                <article key={e.id} className="item">
                  <header>
                    <span className="status">{e.type}</span>
                    <span className="mono">{new Date(e.at).toLocaleString()}</span>
                  </header>
                  <div className="mono">{e.proposalId}</div>
                  <p style={{ margin: "6px 0 0" }}>{e.detail}</p>
                </article>
              ))
            )}
          </div>
          <p className="foot">
            Default mode is <code>mock</code>. Sandbox:{" "}
            <code>vault-run paypal-sandbox -- npm run dev</code> with{" "}
            <code>PAYGUARD_MODE=sandbox</code>. Live PayPal endpoints are refused.
          </p>
        </section>
      </div>
    </main>
  );
}
