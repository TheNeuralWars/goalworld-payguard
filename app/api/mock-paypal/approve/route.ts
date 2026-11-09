import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/runtime";
import { canSimulatePayer } from "@/lib/paypal/types";
import type { MockPayPalAdapter } from "@/lib/paypal/mock-adapter";

export const dynamic = "force-dynamic";

/**
 * MOCK ONLY — stands in for the buyer clicking "Pay Now" on paypal.com.
 * In sandbox mode this route refuses; the real approval happens on sandbox.paypal.com.
 */
export async function POST(req: Request) {
  const pipe = await getPipeline();
  const adapter = pipe.adapter as MockPayPalAdapter;
  if (!canSimulatePayer(adapter) || typeof adapter.returnTarget !== "function") {
    return NextResponse.json({ error: "payer simulation is only available in mock mode" }, { status: 404 });
  }
  const form = await req.formData();
  const token = String(form.get("token") || "");
  const decision = String(form.get("decision") || "");
  try {
    if (decision === "approve") await adapter.simulatePayerApproval(token);
    else await adapter.simulatePayerCancel(token);
    return NextResponse.redirect(new URL(adapter.returnTarget(token, decision === "approve")), 303);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
