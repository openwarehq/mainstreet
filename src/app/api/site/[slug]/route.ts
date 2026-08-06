import { readSite } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Serves a generated site.
 *
 * `X-Frame-Options` is deliberately absent so the dashboard can preview it in
 * an iframe on the same origin, and the sites are marked `noindex` in their own
 * markup — a draft proposal for a business that has not agreed to it should not
 * turn up in search results.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const html = readSite(slug);
  if (!html) return new Response("Not found", { status: 404 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
