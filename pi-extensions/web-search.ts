/**
 * Web Search Extension
 *
 * Adds a `web_search` tool powered by Tavily's search API.
 * Requires TAVILY_API_KEY environment variable.
 *
 * Usage:
 *   pi -e pi-extensions/web-search.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Parameters — goal-oriented, not provider-shaped
// ---------------------------------------------------------------------------

const WebSearchParams = Type.Object({
  objective: Type.String({
    description:
      "A natural-language description of the broader task or research goal, " +
      "including any source or freshness guidance.",
  }),
  search_queries: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional keyword queries to ensure matches for specific terms are " +
        "prioritized (recommended for best results).",
    }),
  ),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return (1-20)",
      minimum: 1,
      maximum: 20,
      default: 8,
    }),
  ),
  topic: Type.Optional(
    Type.Union([Type.Literal("general"), Type.Literal("news")], {
      description: "Type of search — general for web, news for recent articles",
      default: "general",
    }),
  ),
  // Backward-compatible alias
  query: Type.Optional(
    Type.String({
      description:
        "Deprecated — use objective instead. Treated as objective if objective is empty.",
    }),
  ),
});

type WebSearchParamsType = Static<typeof WebSearchParams>;

// ---------------------------------------------------------------------------
// Search state & result types
// ---------------------------------------------------------------------------

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
  score: number;
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time: number;
}

interface SearchState {
  status: "running" | "done" | "error" | "aborted";
  query: string;
  answer?: string;
  results: TavilyResult[];
  responseTime?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Result sections — structured representation for TUI
// ---------------------------------------------------------------------------

interface ResultSection {
  title: string;
  url?: string;
  lines: string[];
}

function resultsToSections(state: SearchState): ResultSection[] {
  const sections: ResultSection[] = [];

  if (state.answer) {
    sections.push({ title: "Summary", lines: [state.answer] });
  }

  for (const item of state.results) {
    sections.push({
      title: item.title || "(untitled)",
      url: item.url,
      lines: [item.content],
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Formatting — LLM (markdown) vs TUI (sections)
// ---------------------------------------------------------------------------

function formatForLLM(state: SearchState): string {
  const lines: string[] = [];

  if (state.answer) {
    lines.push("### Summary");
    lines.push(state.answer);
  }

  if (state.results.length > 0) {
    lines.push(`\n### Results (${state.results.length} found)`);
    for (const item of state.results) {
      lines.push(`\n**[${item.title}](${item.url})**`);
      lines.push(item.content);
    }
  } else {
    lines.push("\nNo results found");
  }

  return lines.join("\n");
}

function formatSectionsCollapsed(
  sections: ResultSection[],
  maxSections: number,
  maxExcerptChars: number,
): string {
  const visible = sections.slice(0, maxSections);
  const remaining = sections.length - visible.length;
  const lines: string[] = [];

  for (const section of visible) {
    lines.push(`**${section.title}**`);
    if (section.url) lines.push(section.url);
    const excerpt = section.lines.join("\n");
    if (excerpt.length > maxExcerptChars) {
      lines.push(excerpt.slice(0, maxExcerptChars) + "…");
    } else {
      lines.push(excerpt);
    }
    lines.push("");
  }

  if (remaining > 0) {
    lines.push(`… ${remaining} more result${remaining === 1 ? "" : "s"}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Abort helpers
// ---------------------------------------------------------------------------

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

// ---------------------------------------------------------------------------
// Search transport — Tavily via fetch
// ---------------------------------------------------------------------------

const TAVILY_API_URL = "https://api.tavily.com/search";

interface SearchDeps {
  getApiKey: () => string | undefined;
  fetchFn: typeof fetch;
}

const DEFAULT_DEPS: SearchDeps = {
  getApiKey: () => process.env.TAVILY_API_KEY,
  fetchFn: fetch,
};

async function performSearch(
  params: WebSearchParamsType,
  signal: AbortSignal | undefined,
  deps: SearchDeps,
): Promise<SearchState> {
  const objective = params.objective?.trim() || params.query?.trim() || "";

  if (objective.length === 0) {
    return { status: "error", query: "", results: [], error: "objective cannot be empty" };
  }

  const apiKey = deps.getApiKey();
  if (!apiKey) {
    return {
      status: "error",
      query: objective,
      results: [],
      error: "No API key found. Set TAVILY_API_KEY environment variable.",
    };
  }

  throwIfAborted(signal);

  const body = {
    api_key: apiKey,
    query: objective,
    search_depth: "basic" as const,
    max_results: params.max_results ?? 8,
    include_answer: true,
    include_raw_content: false,
    topic: params.topic ?? "general",
    ...(params.search_queries?.length ? { search_queries: params.search_queries } : {}),
  };

  try {
    const response = await deps.fetchFn(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    throwIfAborted(signal);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = (await response.json()) as {
          detail?: { error?: string };
          error?: string;
        };
        errorMessage = errorData.detail?.error || errorData.error || errorMessage;
      } catch {
        // Use default error message
      }
      return { status: "error", query: objective, results: [], error: errorMessage };
    }

    const data = (await response.json()) as TavilyResponse;

    throwIfAborted(signal);

    return {
      status: "done",
      query: data.query,
      answer: data.answer,
      results: data.results,
      responseTime: data.response_time,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "aborted", query: objective, results: [], error: "Search was cancelled" };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "aborted", query: objective, results: [], error: "Search was cancelled" };
    }
    const msg = error instanceof Error ? error.message : "An unexpected error occurred";
    return { status: "error", query: objective, results: [], error: `Network error: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// TUI rendering
// ---------------------------------------------------------------------------

function renderWebSearchCall(
  args: Record<string, unknown>,
  theme: Record<string, (text: string) => string>,
): Text {
  const objective =
    typeof args.objective === "string"
      ? args.objective.trim()
      : typeof args.query === "string"
        ? args.query.trim()
        : "";
  const topic = typeof args.topic === "string" ? args.topic : "general";
  const preview = objective.length > 70 ? `${objective.slice(0, 70)}…` : objective;

  let text = theme.toolTitle(theme.bold("web_search"));
  if (preview) {
    text += `\n${theme.muted(topic)} · ${theme.dim(preview)}`;
  }
  if (Array.isArray(args.search_queries) && args.search_queries.length) {
    text += theme.muted(` [${args.search_queries.join(", ")}]`);
  }
  return new Text(text, 0, 0);
}

function statusIcon(status: string, theme: Record<string, (text: string) => string>): string {
  switch (status) {
    case "done":
      return theme.success("✓");
    case "error":
      return theme.error("✗");
    case "aborted":
      return theme.warning("◼");
    default:
      return theme.warning("⏳");
  }
}

function renderWebSearchResult(
  result: { content: Array<{ type: string; text: string }>; details?: SearchState },
  opts: { expanded: boolean; isPartial: boolean },
  theme: Record<string, (text: string) => string>,
): Text | Container {
  const state = result.details;
  if (!state) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const status = opts.isPartial ? "running" : state.status;
  const icon = statusIcon(status, theme);
  const totalResults = state.results.length;
  const responseTimeInfo = state.responseTime ? ` · ${state.responseTime.toFixed(2)}s` : "";

  const header =
    icon +
    " " +
    theme.toolTitle(theme.bold("web_search ")) +
    theme.dim(`${totalResults} result${totalResults === 1 ? "" : "s"}${responseTimeInfo}`);

  if (status === "running") {
    return new Text(`${header}\n\n${theme.dim("Searching Tavily…")}`, 0, 0);
  }

  if (state.error) {
    return new Text(`${header}\n\n${theme.error(state.error)}`, 0, 0);
  }

  const sections = resultsToSections(state);

  if (!opts.expanded) {
    const collapsed = formatSectionsCollapsed(sections, 3, 280);
    let text = `${header}\n\n${collapsed}`;
    if (sections.length > 3) {
      text += `\n${theme.dim("(Ctrl+O to expand)")}`;
    }
    return new Text(text, 0, 0);
  }

  const fullMarkdown = formatForLLM(state).trim() || "(no output)";
  const mdTheme = getMarkdownTheme();
  const container = new Container();
  container.addChild(new Text(header, 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(new Markdown(fullMarkdown, 0, 0, mdTheme));
  return container;
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
	performSearch,
	formatForLLM,
	resultsToSections,
	formatSectionsCollapsed,
	throwIfAborted,
};

export type { SearchState, TavilyResult, ResultSection, SearchDeps };

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function webSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information using Tavily's search API.\n" +
      "Use when you need up-to-date information that may not be in your training data.\n\n" +
      "- Provide an `objective` describing what you want to learn.\n" +
      "- Optionally add `search_queries` with specific keyword terms to prioritize.\n" +
      "- Set `topic` to 'news' for recent articles.\n\n" +
      "Examples:\n" +
      '  {"objective":"Find the latest Node.js LTS version and its release date"}\n' +
      '  {"objective":"Compare Bun vs Deno runtime performance","search_queries":["bun benchmark","deno benchmark"]}',
    parameters: WebSearchParams,

    async execute(
      _toolCallId: string,
      rawParams: unknown,
      signal?: AbortSignal,
      onUpdate?: (update: {
        content: Array<{ type: string; text: string }>;
        details: SearchState;
      }) => void,
    ) {
      const params = rawParams as WebSearchParamsType;
      const objective = params.objective?.trim() || params.query?.trim() || "";

      if (objective.length === 0) {
        return {
          content: [{ type: "text", text: "Invalid parameters: objective cannot be empty" }],
          details: { status: "error" as const, query: "", results: [] },
          isError: true,
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Searching for "${objective}"...` }],
        details: { status: "running", query: objective, results: [] },
      });

      const result = await performSearch(params, signal, DEFAULT_DEPS);
      const text = formatForLLM(result);

      return {
        content: [{ type: "text", text }],
        details: result,
        isError: result.status === "error",
      };
    },

    renderCall(args: Record<string, unknown>, theme: Record<string, (text: string) => string>) {
      return renderWebSearchCall(args, theme);
    },

    renderResult(
      result: { content: Array<{ type: string; text: string }>; details?: SearchState },
      opts: { expanded: boolean; isPartial: boolean },
      theme: Record<string, (text: string) => string>,
    ) {
      return renderWebSearchResult(result, opts, theme);
    },
  });
}
