/**
 * The Anthropic Messages API, hit directly.
 *
 * No SDK. One `fetch` against one endpoint is the whole integration, and adding
 * a dependency to save fifteen lines is not worth the install for a tool whose
 * point is that it runs locally with nothing configured but a key.
 *
 * Two failure modes get explicit handling because both are common and both
 * look like a hang otherwise:
 *
 * - **Rate limits and overloads** (429, 529, 5xx) are retried with backoff. A
 *   batch of forty sites will hit one, and losing a site to a transient 429
 *   after paying for the tokens on either side of it is the worst outcome.
 * - **A missing or rejected key** fails immediately with a message that says
 *   which it was, because "request failed" sends you looking in the wrong
 *   place.
 */

export type Completion = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  /** False when the model is not in the price table — tokens still count. */
  priced: boolean;
  usd: number;
};

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

/**
 * Published per-million-token rates, matched by family prefix.
 *
 * Prefix rather than exact id on purpose: a point release ships a new model id
 * at the same price, and a table keyed on exact ids silently reports $0 the day
 * that happens. A model matching nothing here is reported as **unpriced** and
 * its tokens are still counted — the one thing this must never do is quietly
 * show a cost of zero for work that cost money.
 */
const RATES: Array<{ prefix: string; in: number; out: number }> = [
  { prefix: "claude-opus-", in: 15, out: 75 },
  { prefix: "claude-sonnet-", in: 3, out: 15 },
  { prefix: "claude-haiku-", in: 1, out: 5 },
  { prefix: "claude-fable-", in: 3, out: 15 },
];

export function price(model: string, inTok: number, outTok: number): { usd: number; priced: boolean } {
  const rate = RATES.find((r) => model.startsWith(r.prefix));
  if (!rate) return { usd: 0, priced: false };
  return { usd: (inTok * rate.in + outTok * rate.out) / 1_000_000, priced: true };
}

export const DEFAULT_MODEL = process.env.MAINSTREET_MODEL ?? "claude-sonnet-5";

export function apiKey(): string | null {
  const k = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  return k ? k : null;
}

export function hasKey(): boolean {
  return apiKey() !== null;
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Args = {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Text the assistant turn is forced to start with. */
  prefill?: string;
  signal?: AbortSignal;
};

export async function complete(args: Args): Promise<Completion> {
  const key = apiKey();
  if (!key) {
    throw new ClaudeError(
      "ANTHROPIC_API_KEY is not set — put it in .env.local to have Claude design the sites.",
      null,
    );
  }

  const model = args.model ?? DEFAULT_MODEL;
  const started = Date.now();

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: args.prompt },
  ];
  // A prefill makes the model continue rather than introduce. Without it the
  // reply opens "Here's the site:" and the first line of the file is prose.
  if (args.prefill) messages.push({ role: "assistant", content: args.prefill });

  let lastError: ClaudeError | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(700 * 2 ** (attempt - 1));

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: args.maxTokens ?? 8000,
          temperature: args.temperature ?? 1,
          system: args.system,
          messages,
        }),
        signal: args.signal ?? AbortSignal.timeout(180_000),
      });
    } catch (e) {
      lastError = new ClaudeError(`request failed: ${(e as Error).message}`, null);
      continue;
    }

    if (res.ok) {
      const json = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
        stop_reason?: string;
      };
      const text = (json.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      const inputTokens = json.usage?.input_tokens ?? 0;
      const outputTokens = json.usage?.output_tokens ?? 0;
      const used = json.model ?? model;
      const { usd, priced } = price(used, inputTokens, outputTokens);
      return {
        // The prefill is part of the assistant turn but is not echoed back, so
        // it has to be put back on the front or the HTML starts mid-doctype.
        text: (args.prefill ?? "") + text,
        model: used,
        inputTokens,
        outputTokens,
        ms: Date.now() - started,
        priced,
        usd,
      };
    }

    const body = await res.text().catch(() => "");
    const detail = body.slice(0, 300);

    if (res.status === 401 || res.status === 403) {
      throw new ClaudeError(`API key rejected (${res.status}). ${detail}`, res.status);
    }
    if (res.status === 404) {
      throw new ClaudeError(`model "${model}" is not available on this key.`, 404);
    }
    if (res.status === 400) {
      throw new ClaudeError(`request rejected: ${detail}`, 400);
    }
    // 429 / 529 / 5xx — worth another go.
    lastError = new ClaudeError(`${res.status}: ${detail}`, res.status);
  }

  throw lastError ?? new ClaudeError("request failed", null);
}
