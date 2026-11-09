import { NextResponse } from "next/server";
import { getPipeline } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const pipe = await getPipeline();
  return NextResponse.json({ events: pipe.audit.listEvents() });
}
