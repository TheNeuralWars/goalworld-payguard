import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const pipe = await getPipeline();
    const proposal = await pipe.humanApprove(id);
    return NextResponse.json({ proposal });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
