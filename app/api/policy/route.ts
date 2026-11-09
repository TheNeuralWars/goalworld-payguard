import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** Live brakes: caps, spent, held, remaining, allowlist, which brain is active. */
export async function GET() {
  const pipe = await getPipeline();
  return NextResponse.json({
    policy: pipe.policy.snapshot(),
    reasoner: { kind: pipe.reasoner.kind, model: pipe.reasoner.model ?? null },
    adapter: pipe.adapter.mode,
  });
}
