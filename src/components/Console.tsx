"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineEvent } from "@/lib/pipeline";
import type { Scored } from "@/lib/score";
import type { SiteRow } from "@/lib/db";

type Stats = { prospects: number; withoutSite: number; built: number; areas: number; bytes: number };
type State = { stats: Stats; prospects: Scored[]; sites: SiteRow[]; now: number };

/** The stages, in the order the pipeline emits them. */
const STAGES = [
  { id: "discovering", label: "Discover", note: "OpenStreetMap" },
  { id: "scored", label: "Score", note: "no website = lead" },
  { id: "spec", label: "Spec", note: "auto-approved" },
  { id: "built", label: "Build", note: "one file each" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

const fmtBytes = (n: number) =>
  n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : `${Math.round(n / 1000)}KB`;

const ago = (ts: number, now: number) => {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export function Console() {
  const [state, setState] = useState<State | null>(null);
  const [area, setArea] = useState("Newtown");
  const [build, setBuild] = useState(8);
  const [log, setLog] = useState<Array<{ e: PipelineEvent; at: number }>>([]);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<StageId | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      setState((await r.json()) as State);
    } catch {
      /* the console stays usable with stale counts */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setRunning(false);
    setStage(null);
  }, []);

  const start = useCallback(async () => {
    const a = area.trim();
    if (!a || running) return;

    setLog([]);
    setError(null);
    setRunning(true);
    setStage("discovering");

    const ctrl = new AbortController();
    abort.current = ctrl;

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: a, build }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: `run returned ${res.status}` }));
        setError(j.error ?? "could not start");
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // A chunk can split an SSE frame anywhere, so only whole frames are
        // consumed and the tail is kept for the next read.
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let e: PipelineEvent;
          try {
            e = JSON.parse(line.slice(6)) as PipelineEvent;
          } catch {
            continue;
          }
          setLog((l) => [...l, { e, at: Date.now() }]);
          if (e.t === "discovering" || e.t === "scored" || e.t === "spec" || e.t === "built") {
            setStage(e.t as StageId);
          }
          if (e.t === "built") void load();
          if (e.t === "failed") setError(e.message);
          if (e.t === "done") setStage(null);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
      abort.current = null;
      void load();
    }
  }, [area, build, running, load]);

  const s = state?.stats;
  const now = Date.now();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      {/* ── header ──────────────────────────────────────────────────── */}
      <header className="flex h-[58px] shrink-0 items-center gap-4 border-b border-line bg-bg-2 px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded bg-lime text-[13px] font-bold text-bg">
            m
          </span>
          <div>
            <div className="text-[13px] leading-none font-semibold">mainstreet</div>
            <div className="tag mt-[3px]">automated local web agency</div>
          </div>
        </div>

        <div className="ml-4 flex flex-1 items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded border border-line bg-bg px-3 py-2 focus-within:border-line-2">
            <span className="tag shrink-0">area</span>
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void start()}
              disabled={running}
              placeholder="a suburb, town or district — e.g. Newtown"
              className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2 rounded border border-line bg-bg px-3 py-2">
            <span className="tag shrink-0">build</span>
            <input
              type="number"
              min={1}
              max={40}
              value={build}
              onChange={(e) => setBuild(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
              disabled={running}
              className="num w-[38px] bg-transparent text-[12.5px] text-ink outline-none disabled:opacity-50"
            />
          </div>
          {running ? (
            <button
              onClick={stop}
              className="num shrink-0 rounded border border-coral/50 px-4 py-2 text-[10px] tracking-[0.1em] text-coral uppercase hover:bg-coral/10"
            >
              ■ Stop
            </button>
          ) : (
            <button
              onClick={() => void start()}
              disabled={!area.trim()}
              className="num shrink-0 rounded bg-lime px-4 py-2 text-[10px] font-semibold tracking-[0.1em] text-bg uppercase disabled:opacity-30"
            >
              ▶ Run agency
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-5 border-l border-line pl-5">
          {[
            ["prospects", s?.prospects ?? 0],
            ["no site", s?.withoutSite ?? 0],
            ["built", s?.built ?? 0],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <div className="num text-[17px] leading-none font-semibold text-ink">
                {(v as number).toLocaleString()}
              </div>
              <div className="tag mt-1">{k}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── stage rail ──────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-stretch gap-2 border-b border-line bg-bg-2 px-4 py-2.5">
        {STAGES.map((st, i) => {
          const active = stage === st.id;
          const passed =
            stage !== null && STAGES.findIndex((x) => x.id === stage) > i;
          return (
            <div
              key={st.id}
              className={`relative flex flex-1 items-center gap-3 overflow-hidden rounded border px-3 py-2 transition-colors ${
                active
                  ? "border-lime/50 bg-lime/5"
                  : passed
                    ? "border-line-2 bg-bg-3"
                    : "border-line bg-bg"
              }`}
            >
              <span
                className={`num flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded text-[10px] ${
                  active ? "bg-lime text-bg" : passed ? "bg-line-2 text-ink-2" : "bg-bg-3 text-ink-3"
                }`}
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <div
                  className={`text-[11.5px] leading-none font-medium ${active ? "text-lime" : passed ? "text-ink-2" : "text-ink-3"}`}
                >
                  {st.label}
                </div>
                <div className="tag mt-1 truncate">{st.note}</div>
              </div>
              {active && (
                <span className="sweep absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-lime/10 to-transparent" />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="shrink-0 border-b border-coral/30 bg-coral/10 px-4 py-2 text-[11.5px] text-coral">
          {error}
        </div>
      )}

      {/* ── body ────────────────────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr_320px]">
        {/* prospects */}
        <aside className="flex min-h-0 flex-col border-r border-line">
          <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2.5">
            <span className="tag">discovered</span>
            <span className="tag">{state?.prospects.length ?? 0} ranked</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!state?.prospects.length && (
              <div className="tag px-3 py-10 text-center leading-relaxed">
                nothing yet.
                <br />
                name an area and run.
              </div>
            )}
            {state?.prospects.map((p) => (
              <div key={p.id} className="border-b border-line/60 px-3 py-2.5 hover:bg-bg-2">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[11.5px] text-ink">{p.name}</span>
                  <span
                    className={`num ml-auto shrink-0 text-[10px] ${p.score >= 60 ? "text-lime" : p.score > 0 ? "text-amber" : "text-ink-3"}`}
                  >
                    {p.score}
                  </span>
                </div>
                <div className="tag mt-1 truncate">{p.kind.replace(/_/g, " ")}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.reasons.slice(0, 3).map((r) => (
                    <span
                      key={r}
                      className={`num rounded px-1.5 py-[1px] text-[8.5px] ${
                        r === "no website"
                          ? "bg-lime/15 text-lime"
                          : r === "already has a site"
                            ? "bg-bg-3 text-ink-3"
                            : "bg-bg-3 text-ink-2"
                      }`}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* pipeline log + preview */}
        <main className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
            <span className="tag">pipeline</span>
            <span className="flex items-center gap-2">
              {running && <span className="pulse h-[5px] w-[5px] rounded-full bg-lime" />}
              <span className="tag">{running ? "running" : "idle"} · no approval gate</span>
            </span>
          </div>

          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {!log.length && (
              <div className="tag py-14 text-center leading-relaxed">
                the pipeline runs end to end.
                <br />
                discovery, spec and build with nothing to approve.
              </div>
            )}
            {log.map((entry, i) => (
              <LogLine key={i} e={entry.e} onPreview={setPreview} />
            ))}
          </div>

          {preview && (
            <div className="flex h-[52%] shrink-0 flex-col border-t border-line">
              <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
                <span className="tag">preview</span>
                <span className="num truncate text-[11px] text-ink-2">/{preview}</span>
                <a
                  href={`/api/site/${preview}`}
                  target="_blank"
                  rel="noreferrer"
                  className="num ml-auto shrink-0 rounded border border-line px-2.5 py-1 text-[9px] tracking-[0.1em] text-ink-2 uppercase hover:border-line-2 hover:text-ink"
                >
                  Open ↗
                </a>
                <button
                  onClick={() => setPreview(null)}
                  className="num shrink-0 rounded border border-line px-2.5 py-1 text-[9px] tracking-[0.1em] text-ink-3 uppercase hover:text-ink"
                >
                  Close
                </button>
              </div>
              <iframe
                src={`/api/site/${preview}`}
                title={preview}
                className="min-h-0 flex-1 bg-white"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </main>

        {/* built */}
        <aside className="flex min-h-0 flex-col border-l border-line">
          <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2.5">
            <span className="tag">built</span>
            <span className="tag">{s ? fmtBytes(s.bytes) : "—"}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!state?.sites.length && (
              <div className="tag px-3 py-10 text-center">no sites yet</div>
            )}
            {state?.sites.map((site) => (
              <button
                key={site.slug}
                onClick={() => setPreview(site.slug)}
                className={`enter block w-full border-b border-line/60 px-3 py-2.5 text-left hover:bg-bg-2 ${
                  preview === site.slug ? "bg-bg-3" : ""
                }`}
              >
                <div className="truncate text-[11.5px] text-ink">{site.business}</div>
                <div className="tag mt-1 truncate">{site.category}</div>
                <div className="num mt-1 flex gap-2 text-[9px] text-ink-3">
                  <span>{Math.round(site.bytes / 1000)}KB</span>
                  <span>·</span>
                  <span>{ago(site.built_at, now)} ago</span>
                </div>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {/* ── footer ──────────────────────────────────────────────────── */}
      <div className="flex h-[26px] shrink-0 items-center gap-4 border-t border-line bg-bg-2 px-4">
        <span className="num flex items-center gap-1.5 text-[9px] tracking-[0.1em] text-lime uppercase">
          <span className="h-[5px] w-[5px] rounded-full bg-lime" />
          mainstreet
        </span>
        <span className="num text-[9.5px] text-ink-3">
          {s?.areas ?? 0} areas · {s?.prospects ?? 0} prospects · {s?.built ?? 0} sites
        </span>
        <span className="num ml-auto text-[9.5px] text-ink-3">
          every site is a draft proposal · data © OpenStreetMap contributors, ODbL
        </span>
      </div>
    </div>
  );
}

/** One line of the run log. Each event type reads differently on purpose. */
function LogLine({ e, onPreview }: { e: PipelineEvent; onPreview: (slug: string) => void }) {
  const base = "enter flex items-baseline gap-3 py-[5px] text-[11.5px]";

  switch (e.t) {
    case "started":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">start</span>
          <span className="text-ink-2">
            searching <span className="text-ink">{e.area}</span>, up to {e.limit} records
          </span>
        </div>
      );
    case "discovering":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">osm</span>
          <span className="pulse text-ink-3">querying Overpass…</span>
        </div>
      );
    case "discovered":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">osm</span>
          <span className="text-ink-2">
            <span className="num text-teal">{e.found}</span> businesses from {e.endpoint} in{" "}
            <span className="num">{(e.ms / 1000).toFixed(1)}s</span>
          </span>
        </div>
      );
    case "scored":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">score</span>
          <span className="text-ink-2">
            <span className="num text-lime">{e.leads}</span> leads ·{" "}
            <span className="num text-ink-3">{e.skipped}</span> already have a site
          </span>
        </div>
      );
    case "queued":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">queue</span>
          <span className="text-ink-2">
            <span className="num text-amber">{e.slugs.length}</span> specs auto-approved
          </span>
        </div>
      );
    case "spec":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">spec</span>
          <span className="text-ink-2">
            <span className="text-ink">{e.business}</span>
            <span className="text-ink-3"> · {e.category} · {e.sections} sections</span>
          </span>
        </div>
      );
    case "built":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">build</span>
          <span className="flex items-baseline gap-2 text-ink-2">
            <span className="text-lime">✓</span>
            <button
              onClick={() => onPreview(e.slug)}
              className="text-ink underline decoration-line-2 underline-offset-2 hover:decoration-lime"
            >
              {e.business}
            </button>
            <span className="num text-ink-3">
              {Math.round(e.bytes / 1000)}KB · {e.ms}ms
            </span>
          </span>
        </div>
      );
    case "skipped":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">skip</span>
          <span className="text-ink-3">
            {e.business} — {e.why}
          </span>
        </div>
      );
    case "done":
      return (
        <div className={`${base} mt-2 border-t border-line pt-3`}>
          <span className="tag w-[64px] shrink-0">done</span>
          <span className="text-ink-2">
            <span className="num text-lime">{e.built}</span> sites in{" "}
            <span className="num">{(e.ms / 1000).toFixed(1)}s</span>
          </span>
        </div>
      );
    case "failed":
      return (
        <div className={base}>
          <span className="tag w-[64px] shrink-0">error</span>
          <span className="text-coral">{e.message}</span>
        </div>
      );
  }
}
