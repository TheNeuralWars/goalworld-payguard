import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const pipe = await getPipeline();
  return NextResponse.json({ proposals: pipe.audit.listProposals() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      intent?: string;
      payeeEmail?: string;
      amountCents?: number;
      category?: "creator_payout" | "tool_api" | "ops_escrow" | "other";
    };
    if (!body.intent || body.intent.trim().length < 3) {
      return NextResponse.json({ error: "intent required" }, { status: 400 });
    }
    const pipe = await getPipeline();
    const proposal = await pipe.submitIntent({
      intent: body.intent,
      payeeEmail: body.payeeEmail,
      amountCents: body.amountCents,
      category: body.category,
    });
    return NextResponse.json({ proposal });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
