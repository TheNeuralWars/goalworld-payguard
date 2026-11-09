import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** PayPal return_url: ?proposal=<id>&token=<orderId>&PayerID=… → verify APPROVED → capture. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const proposal = url.searchParams.get("proposal") || "";
  const token = url.searchParams.get("token") || "";
  const home = new URL("/", url);
  try {
    const pipe = await getPipeline();
    const p = await pipe.completePayerApproval(proposal, token);
    home.searchParams.set("focus", p.id);
    home.searchParams.set("result", p.status);
  } catch (err) {
    home.searchParams.set("error", err instanceof Error ? err.message : String(err));
  }
  return NextResponse.redirect(home, 303);
}
