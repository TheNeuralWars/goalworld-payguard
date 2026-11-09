import { promises as fs } from "node:fs";
import path from "node:path";
import type { PaymentProposal } from "../agents/types";

export interface AuditEvent {
  id: string;
  at: string;
  type:
    | "propose"
    | "guard"
    | "human_approve"
    | "human_reject"
    | "execute"
    | "fail";
  proposalId: string;
  detail: string;
  meta?: Record<string, unknown>;
}

export class AuditStore {
  private events: AuditEvent[] = [];
  private proposals = new Map<string, PaymentProposal>();

  constructor(private persistPath?: string) {}

  async load(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const raw = await fs.readFile(this.persistPath, "utf8");
      const data = JSON.parse(raw) as {
        events: AuditEvent[];
        proposals: PaymentProposal[];
      };
      this.events = data.events || [];
      this.proposals = new Map((data.proposals || []).map((p) => [p.id, p]));
    } catch {
      /* fresh */
    }
  }

  private async flush(): Promise<void> {
    if (!this.persistPath) return;
    await fs.mkdir(path.dirname(this.persistPath), { recursive: true });
    await fs.writeFile(
      this.persistPath,
      JSON.stringify(
        { events: this.events, proposals: [...this.proposals.values()] },
        null,
        2,
      ),
    );
  }

  async append(event: Omit<AuditEvent, "id" | "at"> & { id?: string; at?: string }) {
    const full: AuditEvent = {
      id: event.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: event.at || new Date().toISOString(),
      type: event.type,
      proposalId: event.proposalId,
      detail: event.detail,
      meta: event.meta,
    };
    this.events.push(full);
    await this.flush();
    return full;
  }

  async saveProposal(p: PaymentProposal) {
    this.proposals.set(p.id, p);
    await this.flush();
  }

  getProposal(id: string): PaymentProposal | undefined {
    return this.proposals.get(id);
  }

  listProposals(): PaymentProposal[] {
    return [...this.proposals.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  listEvents(): AuditEvent[] {
    return [...this.events].reverse();
  }
}
