import { NextResponse } from "next/server";
import { builtProspectIds } from "@/lib/db";
import { run, type PipelineEvent } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Runs the pipeline and streams every stage.
 *
 * Server-sent events rather than a single response: Overpass regularly takes
 * fifteen seconds on a busy area, and a dashboard that shows nothing until it
 * finishes is indistinguishable from one that has crashed.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    area?: string;
    build?: number;
    limit?: number;
    kinds?: string[];
    includeExisting?: boolean;
  } | null;

  const area = (body?.area ?? "").trim();
  if (!area) return NextResponse.json({ error: "area is required" }, { status: 400 });
  if (area.length > 80) return NextResponse.json({ error: "area is too long" }, { status: 400 });

  const build = Math.max(1, Math.min(40, Number(body?.build) || 8));
  const limit = Math.max(20, Math.min(400, Number(body?.limit) || 200));
  const skip = builtProspectIds();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: PipelineEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      try {
        for await (const event of run({
          area,
          build,
          limit,
          kinds: body?.kinds,
          includeExisting: body?.includeExisting,
          skip,
        })) {
          send(event);
        }
      } catch (e) {
        send({ t: "failed", message: (e as Error).message });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
