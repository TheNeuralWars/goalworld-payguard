import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cfg = loadConfig();
    return NextResponse.json({
      ok: true,
      service: "goalworld-payguard",
      mode: cfg.mode,
      currency: cfg.currency,
      perTxCents: cfg.perTxCents,
      dailyCents: cfg.dailyCents,
      allowPayees: cfg.allowPayees,
      liveEndpointsBlocked: true,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
