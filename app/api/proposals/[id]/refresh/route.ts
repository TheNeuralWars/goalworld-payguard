import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** Poll PayPal for payout batch status (PENDING → SUCCESS) or order status. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const pipe = await getPipeline();
    const existing = pipe.audit.getProposal(id);
    if (existing?.status === "awaiting_payer_approval" && existing.orderId) {
      const proposal = await pipe.completePayerApproval(id, existing.orderId);
      return NextResponse.json({ proposal });
    }
    const proposal = await pipe.refreshPayout(id);
    return NextResponse.json({ proposal });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
