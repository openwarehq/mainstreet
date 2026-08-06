import { NextResponse } from "next/server";
import { listProspects, listSites, stats } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { stats: stats(), prospects: listProspects(120), sites: listSites(60), now: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
