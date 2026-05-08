/**
 * Tavily Web Tools Extension
 *
 * Adds `web_search`, `web_extract`, and `web_crawl` tools powered by Tavily's API.
 * Requires TAVILY_API_KEY environment variable.
 *
 * Usage:
 *   pi -e pi-extensions/web-search.ts
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { TextContent, ImageContent } from "@mariozechner/pi-ai";
import { Type, type Static } from "typebox";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text, Component } from "@mariozechner/pi-tui";

// Local type for ToolRenderContext (not exported publicly)
interface ToolRenderContext<TState = unknown, TArgs = unknown> {
  args: TArgs;
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  state: TState;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isPartial: boolean;
  expanded: boolean;
  showImages: boolean;
  isError: boolean;
}

// ---------------------------------------------------------------------------
// Shared dependencies & helpers
// ---------------------------------------------------------------------------

interface SearchDeps {
  getApiKey: () => string | undefined;
  fetchFn: typeof fetch;
}

const DEFAULT_DEPS: SearchDeps = {
  getApiKey: () => process.env.TAVILY_API_KEY,
  fetchFn: fetch,
};

const DEFAULT_CONTEXT_BUDGET = 12000;
const TRUNCATED_INDICATOR = "…[truncated]";
const CONTEXT_BUDGET = resolveContextBudget();
const SEARCH_RESULT_CHAR_BUDGET = 800;
const SEARCH_TOTAL_CHAR_BUDGET = Math.min(CONTEXT_BUDGET, 8000);
const EXTRACT_RESULT_CHAR_BUDGET = 4000;
const EXTRACT_TOTAL_CHAR_BUDGET = Math.min(CONTEXT_BUDGET, 10000);
const CRAWL_RESULT_CHAR_BUDGET = 2000;
const CRAWL_TOTAL_CHAR_BUDGET = Math.min(CONTEXT_BUDGET, 8000);

function resolveContextBudget(): number {
  const rawValue = process.env.TAVILY_CONTEXT_BUDGET;
  if (!rawValue) {
    return DEFAULT_CONTEXT_BUDGET;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CONTEXT_BUDGET;
  }

  return parsed;
}

function truncateToCharBudget(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }

  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= TRUNCATED_INDICATOR.length) {
    return TRUNCATED_INDICATOR.slice(0, maxChars);
  }

  return `${text.slice(0, maxChars - TRUNCATED_INDICATOR.length)}${TRUNCATED_INDICATOR}`;
}

function createBudgetedTextBuilder(totalBudget: number) {
  const blocks: string[] = [];
  let length = 0;

  return {
    remaining(): number {
      return totalBudget - length - (blocks.length === 0 ? 0 : 1);
    },
    canFit(block: string): boolean {
      return block.length <= this.remaining();
    },
    append(block: string): "full" | "partial" | "none" {
      const separatorLength = blocks.length === 0 ? 0 : 1;
      const remaining = totalBudget - length - separatorLength;

      if (remaining <= 0) {
        return "none";
      }

      const nextBlock = truncateToCharBudget(block, remaining);
      if (!nextBlock) {
        return "none";
      }

      blocks.push(nextBlock);
      length += separatorLength + nextBlock.length;
      return nextBlock.length === block.length ? "full" : "partial";
    },
    toString(): string {
      return blocks.join("\n");
    },
  };
}

function normalizeComparableText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isContentCoveredBySummary(summary: string, content: string): boolean {
  const normalizedSummary = normalizeComparableText(summary);
  const normalizedExcerpt = normalizeComparableText(content.slice(0, 280));

  if (!normalizedSummary || !normalizedExcerpt) {
    return false;
  }

  if (normalizedSummary.includes(normalizedExcerpt)) {
    return true;
  }

  const contentWords = normalizedExcerpt.split(" ").filter((word) => word.length >= 5);
  if (contentWords.length < 8) {
    return false;
  }

  const summaryWords = new Set(normalizedSummary.split(" "));
  const overlapCount = contentWords.filter((word) => summaryWords.has(word)).length;
  return overlapCount / contentWords.length >= 0.7;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

interface TavilyErrorResponse {
  detail?: { error?: string };
  error?: string;
  request_id?: string;
}

async function parseTavilyError(
  response: Response,
): Promise<{ message: string; requestId?: string }> {
  let message = `HTTP ${response.status}: ${response.statusText}`;
  let requestId: string | undefined;
  try {
    const errorData = (await response.json()) as TavilyErrorResponse;
    message = errorData.detail?.error || errorData.error || message;
    requestId = errorData.request_id;
  } catch {
    // Use default error message
  }
  return { message, requestId };
}

function handleTransportError(
  error: unknown,
  operation: string,
): { status: "aborted" | "error"; error: string } {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { status: "aborted", error: `${operation} was cancelled` };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { status: "aborted", error: `${operation} was cancelled` };
  }
  const msg = error instanceof Error ? error.message : "An unexpected error occurred";
  return { status: "error", error: `Network error: ${msg}` };
}

// ---------------------------------------------------------------------------
// Result sections — structured representation for TUI (shared)
// ---------------------------------------------------------------------------

interface ResultSection {
  title: string;
  url?: string;
  lines: string[];
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
// TUI rendering helpers (shared)
// ---------------------------------------------------------------------------

/** Status icon: ✦ while running, ◇ when done. */
function statusIcon(status: string): string {
  if (status !== "done" && status !== "error" && status !== "aborted") return "✦";
  return "◇";
}

function buildResultContainer(header: string, markdown: string, _theme: Theme): Container {
  const mdTheme = getMarkdownTheme();
  const container = new Container();
  container.addChild(new Text(header, 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(new Markdown(markdown.trim() || "(no output)", 0, 0, mdTheme));
  return container;
}

// =============================================================================
// WEB SEARCH
// =============================================================================

// ---------------------------------------------------------------------------
// Search parameters
// ---------------------------------------------------------------------------

const WebSearchParams = Type.Object({
  objective: Type.String({
    description: "Research goal or question for the web search. Keep under 400 characters.",
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
      default: 5,
    }),
  ),
  search_depth: Type.Optional(
    Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
      description: "Search depth — basic for balanced results, advanced for higher relevance",
      default: "basic",
    }),
  ),
  time_range: Type.Optional(
    Type.Union(
      [Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")],
      {
        description: "Filter results by time range",
      },
    ),
  ),
  include_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Domains to include in search results (max 300, supports wildcards like *.com)",
    }),
  ),
  exclude_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Domains to exclude from search results (max 150)",
    }),
  ),
  include_answer: Type.Optional(
    Type.Union([Type.Literal(true), Type.Literal(false)], {
      description: "Include Tavily's AI-generated answer",
      default: false,
    }),
  ),
});

type WebSearchParamsType = Static<typeof WebSearchParams>;

// ---------------------------------------------------------------------------
// Search state & result types
// ---------------------------------------------------------------------------

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
  score: number;
}

interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  response_time: number;
  request_id: string;
}

interface SearchState {
  status: "running" | "done" | "error" | "aborted";
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  responseTime?: number;
  requestId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Search formatting
// ---------------------------------------------------------------------------

function searchResultsToSections(state: SearchState): ResultSection[] {
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

function formatWebSearchForLLM(state: SearchState): string {
  const builder = createBudgetedTextBuilder(SEARCH_TOTAL_CHAR_BUDGET);

  if (state.answer) {
    builder.append(`### Summary\n${state.answer}`);
  }

  if (state.results.length === 0) {
    builder.append("No results found");
    return builder.toString();
  }

  builder.append(`### Results (${state.results.length} found)`);

  const sortedResults = [...state.results].sort((left, right) => right.score - left.score);
  let includedResults = 0;

  for (const item of sortedResults) {
    const title = item.title || "(untitled)";
    const contentCoveredBySummary = state.answer
      ? isContentCoveredBySummary(state.answer, item.content)
      : false;
    const resultLines = [`**[${title}](${item.url})**`];

    if (contentCoveredBySummary) {
      resultLines.push("_Covered by summary; source retained._");
    } else {
      resultLines.push(truncateToCharBudget(item.content, SEARCH_RESULT_CHAR_BUDGET));
    }

    const resultBlock = resultLines.join("\n");
    if (!builder.canFit(resultBlock)) {
      break;
    }

    const appendResult = builder.append(resultBlock);
    includedResults += 1;
    if (appendResult === "partial") {
      break;
    }
  }

  if (includedResults < sortedResults.length) {
    builder.append(
      `... ${sortedResults.length - includedResults} more result${sortedResults.length - includedResults === 1 ? "" : "s"} omitted to stay within context budget.`,
    );
  }

  return builder.toString();
}

// ---------------------------------------------------------------------------
// Search transport
// ---------------------------------------------------------------------------

const TAVILY_SEARCH_API_URL = "https://api.tavily.com/search";

async function performSearch(
  params: WebSearchParamsType,
  signal: AbortSignal | undefined,
  deps: SearchDeps,
): Promise<SearchState> {
  const objective = params.objective?.trim() || "";

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

  // Enforce 400 character limit per Tavily best practices
  const query = objective.length > 400 ? objective.slice(0, 400) : objective;

  throwIfAborted(signal);

  const body: Record<string, unknown> = {
    query,
    search_depth: params.search_depth ?? "basic",
    max_results: params.max_results ?? 5,
    include_answer: params.include_answer ?? false,
    include_raw_content: false,
  };

  if (params.search_queries?.length) {
    body.search_queries = params.search_queries;
  }
  if (params.time_range) {
    body.time_range = params.time_range;
  }
  if (params.include_domains?.length) {
    body.include_domains = params.include_domains;
  }
  if (params.exclude_domains?.length) {
    body.exclude_domains = params.exclude_domains;
  }

  try {
    const response = await deps.fetchFn(TAVILY_SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    throwIfAborted(signal);

    if (!response.ok) {
      const { message: errorMessage, requestId } = await parseTavilyError(response);
      return { status: "error", query: objective, results: [], error: errorMessage, requestId };
    }

    const data = (await response.json()) as TavilySearchResponse;
    throwIfAborted(signal);

    return {
      status: "done",
      query: data.query,
      answer: data.answer,
      results: data.results,
      responseTime: data.response_time,
      requestId: data.request_id,
    };
  } catch (error) {
    const { status, error: errorMsg } = handleTransportError(error, "Search");
    return { status, query: objective, results: [], error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Search TUI rendering
// ---------------------------------------------------------------------------

function renderWebSearchCall(
  args: WebSearchParamsType,
  theme: Theme,
  _context: ToolRenderContext<unknown, WebSearchParamsType>,
): Component {
  const objective = args.objective?.trim() || "";
  const preview = objective.length > 70 ? `${objective.slice(0, 70)}…` : objective;

  let text = theme.fg("toolTitle", theme.bold("web_search"));
  if (preview) {
    text += `\n${theme.fg("dim", preview)}`;
  }
  if (args.search_queries?.length) {
    text += theme.fg("muted", ` [${args.search_queries.join(", ")}]`);
  }
  return new Text(text, 0, 0);
}

function renderWebSearchResult(
  result: AgentToolResult<SearchState>,
  opts: ToolRenderResultOptions,
  theme: Theme,
  _context: ToolRenderContext<unknown, WebSearchParamsType>,
): Component {
  const state = result.details;
  if (!state) {
    const textContent = result.content.find((c) => c.type === "text") as TextContent | undefined;
    return new Text(textContent?.text ?? "(no output)", 0, 0);
  }

  const status = opts.isPartial ? "running" : state.status;
  const icon = statusIcon(status);
  const totalResults = state.results.length;
  const responseTimeInfo = state.responseTime ? ` · ${state.responseTime.toFixed(2)}s` : "";
  const requestIdInfo = state.requestId ? ` · req: ${state.requestId.slice(0, 8)}…` : "";

  const header =
    `${icon} ${theme.fg("toolTitle", theme.bold("web_search"))}` +
    theme.fg(
      "dim",
      ` · ${totalResults} result${totalResults === 1 ? "" : "s"}${responseTimeInfo}${requestIdInfo}`,
    );

  if (status === "running") {
    return new Text(`${header}\n\n${theme.fg("dim", "Searching Tavily…")}`, 0, 0);
  }

  if (state.error) {
    const errorText = state.requestId
      ? `${state.error}\n\n${theme.fg("dim", `Request ID: ${state.requestId} (include in Tavily support tickets)`)}`
      : state.error;
    return new Text(`${header}\n\n${theme.fg("error", errorText)}`, 0, 0);
  }

  const sections = searchResultsToSections(state);

  if (!opts.expanded) {
    const collapsed = formatSectionsCollapsed(sections, 3, 280);
    let text = `${header}\n\n${collapsed}`;
    if (sections.length > 3) {
      text += `\n${theme.fg("dim", "(Ctrl+O to expand)")}`;
    }
    return new Text(text, 0, 0);
  }

  return buildResultContainer(header, formatWebSearchForLLM(state), theme);
}

// =============================================================================
// WEB EXTRACT
// =============================================================================

// ---------------------------------------------------------------------------
// Extract parameters
// ---------------------------------------------------------------------------

const WebExtractParams = Type.Object({
  urls: Type.Array(Type.String(), {
    description: "One or more URLs to extract clean content from (1-20 URLs)",
    minItems: 1,
    maxItems: 20,
  }),
  extract_depth: Type.Optional(
    Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
      description: "Use 'advanced' for JavaScript-heavy or dynamic pages",
      default: "basic",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description: "Focus extraction on content relevant to this query",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: "Maximum wait time in seconds (1.0-60.0) for slow pages",
      minimum: 1,
      maximum: 60,
    }),
  ),
});

type WebExtractParamsType = Static<typeof WebExtractParams>;

// ---------------------------------------------------------------------------
// Extract state & result types
// ---------------------------------------------------------------------------

interface TavilyExtractResult {
  url: string;
  raw_content?: string;
}

interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed?: Array<{ url: string; error?: string }>;
  response_time: number;
  request_id: string;
}

interface ExtractResult {
  url: string;
  title: string;
  content: string;
}

interface ExtractState {
  status: "running" | "done" | "error" | "aborted";
  urls: string[];
  query?: string;
  results: ExtractResult[];
  failed: Array<{ url: string; error?: string }>;
  responseTime?: number;
  requestId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Extract formatting
// ---------------------------------------------------------------------------

function extractResultsToSections(state: ExtractState): ResultSection[] {
  return state.results.map((item) => ({
    title: item.title || item.url,
    url: item.url,
    lines: [item.content],
  }));
}

function formatWebExtractForLLM(state: ExtractState): string {
  const builder = createBudgetedTextBuilder(EXTRACT_TOTAL_CHAR_BUDGET);

  if (state.query) {
    builder.append(`### Extracted content (query: "${state.query}")`);
  } else {
    builder.append("### Extracted content");
  }

  if (state.results.length === 0) {
    builder.append("No content extracted.");
    if (state.failed.length > 0) {
      builder.append(`${state.failed.length} URL(s) failed to extract.`);
    }
    return builder.toString();
  }

  builder.append(`${state.results.length} URL(s) processed successfully.`);

  let includedResults = 0;

  for (const item of state.results) {
    const resultBlock = `**${item.title}**\n${item.url}\n\n${truncateToCharBudget(item.content, EXTRACT_RESULT_CHAR_BUDGET)}`;
    if (!builder.canFit(resultBlock)) {
      break;
    }

    const appendResult = builder.append(resultBlock);
    includedResults += 1;
    if (appendResult === "partial") {
      break;
    }
  }

  if (includedResults < state.results.length) {
    builder.append(
      `... ${state.results.length - includedResults} more URL${state.results.length - includedResults === 1 ? "" : "s"} omitted to stay within context budget.`,
    );
  }

  if (state.failed.length > 0) {
    builder.append(
      `---\n**Failed URLs (${state.failed.length}):**\n${state.failed.map((f) => `- ${f.url}${f.error ? `: ${f.error}` : ""}`).join("\n")}`,
    );
  }

  return builder.toString();
}

// ---------------------------------------------------------------------------
// Extract transport
// ---------------------------------------------------------------------------

const TAVILY_EXTRACT_API_URL = "https://api.tavily.com/extract";

async function performExtract(
  params: WebExtractParamsType,
  signal: AbortSignal | undefined,
  deps: SearchDeps,
): Promise<ExtractState> {
  // Normalize and validate URLs
  const urls = params.urls.map((u) => u.trim()).filter((u) => u.length > 0);

  if (urls.length === 0) {
    return { status: "error", urls: [], results: [], failed: [], error: "No valid URLs provided" };
  }

  if (urls.length > 20) {
    return { status: "error", urls, results: [], failed: [], error: "Maximum 20 URLs allowed" };
  }

  const apiKey = deps.getApiKey();
  if (!apiKey) {
    return {
      status: "error",
      urls,
      results: [],
      failed: [],
      error: "No API key found. Set TAVILY_API_KEY environment variable.",
    };
  }

  throwIfAborted(signal);

  const body: Record<string, unknown> = {
    urls,
    extract_depth: params.extract_depth ?? "basic",
    format: "markdown",
  };

  if (params.query?.trim()) {
    body.query = params.query.trim();
  }
  if (params.timeout) {
    body.timeout = params.timeout;
  }

  try {
    const response = await deps.fetchFn(TAVILY_EXTRACT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    throwIfAborted(signal);

    if (!response.ok) {
      const { message: errorMessage, requestId } = await parseTavilyError(response);
      return { status: "error", urls, results: [], failed: [], error: errorMessage, requestId };
    }

    const data = (await response.json()) as TavilyExtractResponse;
    throwIfAborted(signal);

    // Normalize results
    const results: ExtractResult[] = (data.results || []).map((r) => ({
      url: r.url,
      title: extractTitle(r.url),
      content: r.raw_content || "",
    }));

    // Fallback strategy: retry failed URLs with advanced depth if basic was used
    let finalResults = results;
    let finalFailed = data.failed || [];

    if (finalFailed.length > 0 && (params.extract_depth ?? "basic") === "basic") {
      const failedUrls = finalFailed.map((f) => f.url);
      try {
        const retryBody: Record<string, unknown> = {
          urls: failedUrls,
          extract_depth: "advanced",
          format: "markdown",
        };
        if (params.query?.trim()) {
          retryBody.query = params.query.trim();
        }
        if (params.timeout) {
          retryBody.timeout = params.timeout;
        }

        const retryResponse = await deps.fetchFn(TAVILY_EXTRACT_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(retryBody),
          signal,
        });

        if (retryResponse.ok) {
          const retryData = (await retryResponse.json()) as TavilyExtractResponse;
          const retryResults = (retryData.results || []).map((r) => ({
            url: r.url,
            title: extractTitle(r.url),
            content: r.raw_content || "",
          }));

          // Merge successful retry results (deduplicate by URL)
          const successfulRetryUrls = new Set(retryResults.map((r) => r.url));
          finalResults = [
            ...results.filter((r) => !successfulRetryUrls.has(r.url)),
            ...retryResults,
          ];
          finalFailed = retryData.failed || [];
        }
      } catch {
        // Retry failed, keep original results
      }
    }

    return {
      status: "done",
      urls,
      query: params.query?.trim(),
      results: finalResults,
      failed: finalFailed,
      responseTime: data.response_time,
      requestId: data.request_id,
    };
  } catch (error) {
    const { status, error: errorMsg } = handleTransportError(error, "Extract");
    return { status, urls, results: [], failed: [], error: errorMsg };
  }
}

function extractTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      const last = pathParts[pathParts.length - 1];
      // Remove file extension and convert to title case
      return last.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Extract TUI rendering
// ---------------------------------------------------------------------------

function renderWebExtractCall(
  args: WebExtractParamsType,
  theme: Theme,
  _context: ToolRenderContext<unknown, WebExtractParamsType>,
): Component {
  const urls = args.urls;
  const depth = args.extract_depth ?? "basic";
  const query = args.query?.trim() ?? "";

  const urlPreview =
    urls.length === 1 ? urls[0] : urls.length > 0 ? `${urls.length} URLs` : "no URLs";

  let text = theme.fg("toolTitle", theme.bold("web_extract"));
  text += `\n${theme.fg("muted", depth)} · ${theme.fg("dim", urlPreview.slice(0, 60))}`;
  if (query) {
    const queryPreview = query.length > 40 ? `${query.slice(0, 40)}…` : query;
    text += `\n${theme.fg("dim", `query: ${queryPreview}`)}`;
  }
  return new Text(text, 0, 0);
}

function renderWebExtractResult(
  result: AgentToolResult<ExtractState>,
  opts: ToolRenderResultOptions,
  theme: Theme,
  _context: ToolRenderContext<unknown, WebExtractParamsType>,
): Component {
  const state = result.details;
  if (!state) {
    const textContent = result.content.find((c) => c.type === "text") as TextContent | undefined;
    return new Text(textContent?.text ?? "(no output)", 0, 0);
  }

  const status = opts.isPartial ? "running" : state.status;
  const icon = statusIcon(status);
  const successCount = state.results.length;
  const failedCount = state.failed.length;
  const responseTimeInfo = state.responseTime ? ` · ${state.responseTime.toFixed(2)}s` : "";
  const requestIdInfo = state.requestId ? ` · req: ${state.requestId.slice(0, 8)}…` : "";

  const header =
    `${icon} ${theme.fg("toolTitle", theme.bold("web_extract"))}` +
    theme.fg(
      "dim",
      ` · ${successCount} succeeded${failedCount > 0 ? `, ${failedCount} failed` : ""}${responseTimeInfo}${requestIdInfo}`,
    );

  if (status === "running") {
    return new Text(`${header}\n\n${theme.fg("dim", "Extracting content with Tavily…")}`, 0, 0);
  }

  if (state.error) {
    const errorText = state.requestId
      ? `${state.error}\n\n${theme.fg("dim", `Request ID: ${state.requestId} (include in Tavily support tickets)`)}`
      : state.error;
    return new Text(`${header}\n\n${theme.fg("error", errorText)}`, 0, 0);
  }

  const sections = extractResultsToSections(state);

  if (!opts.expanded) {
    const collapsed = formatSectionsCollapsed(sections, 3, 280);
    let text = `${header}\n\n${collapsed}`;
    if (sections.length > 3) {
      text += `\n${theme.fg("dim", "(Ctrl+O to expand)")}`;
    }
    return new Text(text, 0, 0);
  }

  return buildResultContainer(header, formatWebExtractForLLM(state), theme);
}

// =============================================================================
// WEB CRAWL
// =============================================================================

// ---------------------------------------------------------------------------
// Crawl parameters
// ---------------------------------------------------------------------------

const WebCrawlParams = Type.Object({
  url: Type.String({
    description: "Root URL to crawl",
  }),
  max_depth: Type.Optional(
    Type.Number({
      description: "Maximum crawl depth (1-5). Start with 1-2 and increase if needed.",
      minimum: 1,
      maximum: 5,
      default: 1,
    }),
  ),
  max_breadth: Type.Optional(
    Type.Number({
      description: "Maximum links to follow per page",
      minimum: 1,
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of pages to crawl",
      minimum: 1,
      default: 10,
    }),
  ),
  instructions: Type.Optional(
    Type.String({
      description: "Natural language guidance for semantic focus (2 credits per 10 pages)",
    }),
  ),
  select_paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex patterns for paths to include (e.g. ['/docs/.*', '/api/.*'])",
    }),
  ),
  exclude_paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex patterns for paths to exclude (e.g. ['/blog/.*'])",
    }),
  ),
  select_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex patterns for domains to include (e.g. ['^docs.example.com$'])",
    }),
  ),
  exclude_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex patterns for domains to exclude",
    }),
  ),
  allow_external: Type.Optional(
    Type.Union([Type.Literal(true), Type.Literal(false)], {
      description: "Allow crawling external domains (default: true for crawl)",
      default: true,
    }),
  ),
  extract_depth: Type.Optional(
    Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
      description: "Use 'advanced' for JavaScript-heavy pages (2 credits per 5 URLs vs 1 credit)",
      default: "basic",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: "Maximum wait time in seconds (10-150) for the crawl",
      minimum: 10,
      maximum: 150,
      default: 150,
    }),
  ),
});

type WebCrawlParamsType = Static<typeof WebCrawlParams>;

// ---------------------------------------------------------------------------
// Crawl state & result types
// ---------------------------------------------------------------------------

interface TavilyCrawlResult {
  url: string;
  raw_content?: string;
}

interface TavilyCrawlResponse {
  results: TavilyCrawlResult[];
  response_time: number;
  request_id: string;
}

interface CrawlResult {
  url: string;
  title: string;
  content: string;
}

interface CrawlState {
  status: "running" | "done" | "error" | "aborted";
  url: string;
  instructions?: string;
  results: CrawlResult[];
  responseTime?: number;
  requestId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Crawl formatting
// ---------------------------------------------------------------------------

function crawlResultsToSections(state: CrawlState): ResultSection[] {
  return state.results.map((item) => ({
    title: item.title || item.url,
    url: item.url,
    lines: [item.content],
  }));
}

function formatWebCrawlForLLM(state: CrawlState): string {
  const builder = createBudgetedTextBuilder(CRAWL_TOTAL_CHAR_BUDGET);

  if (state.instructions) {
    builder.append(`### Crawled content (instructions: "${state.instructions}")`);
  } else {
    builder.append("### Crawled content");
  }

  builder.append(`Root URL: ${state.url}`);

  if (state.results.length === 0) {
    builder.append("No pages crawled.");
    return builder.toString();
  }

  builder.append(`${state.results.length} page(s) extracted.`);

  let includedResults = 0;

  for (const item of state.results) {
    const resultBlock = `**${item.title}**\n${item.url}\n\n${truncateToCharBudget(item.content, CRAWL_RESULT_CHAR_BUDGET)}`;
    if (!builder.canFit(resultBlock)) {
      break;
    }

    const appendResult = builder.append(resultBlock);
    includedResults += 1;
    if (appendResult === "partial") {
      break;
    }
  }

  if (includedResults < state.results.length) {
    builder.append(
      `... ${state.results.length - includedResults} more page${state.results.length - includedResults === 1 ? "" : "s"} omitted to stay within context budget.`,
    );
  }

  return builder.toString();
}

// ---------------------------------------------------------------------------
// Crawl transport
// ---------------------------------------------------------------------------

const TAVILY_CRAWL_API_URL = "https://api.tavily.com/crawl";

async function performCrawl(
  params: WebCrawlParamsType,
  signal: AbortSignal | undefined,
  deps: SearchDeps,
): Promise<CrawlState> {
  const url = params.url?.trim();

  if (!url) {
    return { status: "error", url: "", results: [], error: "URL cannot be empty" };
  }

  const apiKey = deps.getApiKey();
  if (!apiKey) {
    return {
      status: "error",
      url,
      results: [],
      error: "No API key found. Set TAVILY_API_KEY environment variable.",
    };
  }

  throwIfAborted(signal);

  const body: Record<string, unknown> = {
    url,
    max_depth: params.max_depth ?? 1,
    limit: params.limit ?? 10,
    extract_depth: params.extract_depth ?? "basic",
    format: "markdown",
    timeout: params.timeout ?? 150,
    allow_external: params.allow_external ?? true,
  };

  if (params.max_breadth) {
    body.max_breadth = params.max_breadth;
  }
  if (params.instructions?.trim()) {
    body.instructions = params.instructions.trim();
  }
  if (params.select_paths?.length) {
    body.select_paths = params.select_paths;
  }
  if (params.exclude_paths?.length) {
    body.exclude_paths = params.exclude_paths;
  }
  if (params.select_domains?.length) {
    body.select_domains = params.select_domains;
  }
  if (params.exclude_domains?.length) {
    body.exclude_domains = params.exclude_domains;
  }

  try {
    const response = await deps.fetchFn(TAVILY_CRAWL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    throwIfAborted(signal);

    if (!response.ok) {
      const { message: errorMessage, requestId } = await parseTavilyError(response);
      return { status: "error", url, results: [], error: errorMessage, requestId };
    }

    const data = (await response.json()) as TavilyCrawlResponse;
    throwIfAborted(signal);

    // Normalize results
    const results: CrawlResult[] = (data.results || []).map((r) => ({
      url: r.url,
      title: extractTitle(r.url),
      content: r.raw_content || "",
    }));

    return {
      status: "done",
      url,
      instructions: params.instructions?.trim(),
      results,
      responseTime: data.response_time,
      requestId: data.request_id,
    };
  } catch (error) {
    const { status, error: errorMsg } = handleTransportError(error, "Crawl");
    return { status, url, results: [], error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Crawl TUI rendering
// ---------------------------------------------------------------------------

function renderWebCrawlCall(
  args: WebCrawlParamsType,
  theme: Theme,
  _context: ToolRenderContext<unknown, WebCrawlParamsType>,
): Component {
  const url = args.url?.trim() ?? "";
  const depth = args.max_depth ?? 1;
  const limit = args.limit ?? 10;
  const instructions = args.instructions?.trim() ?? "";

  const urlPreview = url.length > 50 ? `${url.slice(0, 50)}…` : url;

  let text = theme.fg("toolTitle", theme.bold("web_crawl"));
  text += `\n${theme.fg("muted", `depth ${depth}`)} · ${theme.fg("dim", `limit ${limit}`)}`;
  if (urlPreview) {
    text += `\n${theme.fg("dim", urlPreview)}`;
  }
  if (instructions) {
    const instrPreview = instructions.length > 50 ? `${instructions.slice(0, 50)}…` : instructions;
    text += `\n${theme.fg("dim", `instructions: ${instrPreview}`)}`;
  }
  return new Text(text, 0, 0);
}

function renderWebCrawlResult(
  result: AgentToolResult<CrawlState>,
  opts: ToolRenderResultOptions,
  theme: Theme,
  _context: ToolRenderContext<unknown, WebCrawlParamsType>,
): Component {
  const state = result.details;
  if (!state) {
    const textContent = result.content.find((c) => c.type === "text") as TextContent | undefined;
    return new Text(textContent?.text ?? "(no output)", 0, 0);
  }

  const status = opts.isPartial ? "running" : state.status;
  const icon = statusIcon(status);
  const pageCount = state.results.length;
  const responseTimeInfo = state.responseTime ? ` · ${state.responseTime.toFixed(2)}s` : "";
  const requestIdInfo = state.requestId ? ` · req: ${state.requestId.slice(0, 8)}…` : "";

  const header =
    `${icon} ${theme.fg("toolTitle", theme.bold("web_crawl"))}` +
    theme.fg(
      "dim",
      ` · ${pageCount} page${pageCount === 1 ? "" : "s"}${responseTimeInfo}${requestIdInfo}`,
    );

  if (status === "running") {
    return new Text(`${header}\n\n${theme.fg("dim", "Crawling site with Tavily…")}`, 0, 0);
  }

  if (state.error) {
    const errorText = state.requestId
      ? `${state.error}\n\n${theme.fg("dim", `Request ID: ${state.requestId} (include in Tavily support tickets)`)}`
      : state.error;
    return new Text(`${header}\n\n${theme.fg("error", errorText)}`, 0, 0);
  }

  const sections = crawlResultsToSections(state);

  if (!opts.expanded) {
    const collapsed = formatSectionsCollapsed(sections, 3, 280);
    let text = `${header}\n\n${collapsed}`;
    if (sections.length > 3) {
      text += `\n${theme.fg("dim", "(Ctrl+O to expand)")}`;
    }
    return new Text(text, 0, 0);
  }

  return buildResultContainer(header, formatWebCrawlForLLM(state), theme);
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  // Search
  performSearch,
  formatWebSearchForLLM,
  searchResultsToSections,
  // Extract
  performExtract,
  formatWebExtractForLLM,
  extractResultsToSections,
  // Crawl
  performCrawl,
  formatWebCrawlForLLM,
  crawlResultsToSections,
  // Shared
  formatSectionsCollapsed,
  truncateToCharBudget,
  throwIfAborted,
  parseTavilyError,
  // Backward-compatible aliases
  formatWebSearchForLLM as formatForLLM,
  searchResultsToSections as resultsToSections,
};

export type {
  SearchState,
  TavilySearchResult,
  ExtractState,
  ExtractResult,
  TavilyExtractResult,
  TavilyExtractResponse,
  CrawlState,
  CrawlResult,
  TavilyCrawlResult,
  TavilyCrawlResponse,
  ResultSection,
  SearchDeps,
  WebSearchParamsType,
  WebExtractParamsType,
  WebCrawlParamsType,
};

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function tavilyWebToolsExtension(pi: ExtensionAPI) {
  // --- web_search ---
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web with Tavily for current information.\n" +
      "Provide an `objective`; optionally narrow with `search_queries`, `time_range`, domain filters, or `search_depth: 'advanced'`.",
    parameters: WebSearchParams,

    async execute(
      _toolCallId: string,
      params: WebSearchParamsType,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<SearchState> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<SearchState>> {
      const objective = params.objective?.trim() || "";

      if (objective.length === 0) {
        return {
          content: [{ type: "text", text: "Invalid parameters: objective cannot be empty" }],
          details: { status: "error" as const, query: "", results: [] },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Searching for "${objective}"...` }],
        details: { status: "running", query: objective, results: [] },
      });

      const result = await performSearch(params, signal, DEFAULT_DEPS);
      const text = formatWebSearchForLLM(result);

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },

    renderCall(
      args: WebSearchParamsType,
      theme: Theme,
      context: ToolRenderContext<unknown, WebSearchParamsType>,
    ): Component {
      return renderWebSearchCall(args, theme, context);
    },

    renderResult(
      result: AgentToolResult<SearchState>,
      options: ToolRenderResultOptions,
      theme: Theme,
      context: ToolRenderContext<unknown, WebSearchParamsType>,
    ): Component {
      return renderWebSearchResult(result, options, theme, context);
    },
  });

  // --- web_extract ---
  pi.registerTool({
    name: "web_extract",
    label: "Web Extract",
    description:
      "Extract clean markdown from specific URLs with Tavily.\n" +
      "Use `extract_depth: 'advanced'` for JavaScript-heavy pages, `query` to focus the extract, and `timeout` for slow sites.",
    parameters: WebExtractParams,

    async execute(
      _toolCallId: string,
      params: WebExtractParamsType,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<ExtractState> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<ExtractState>> {
      const urls = params.urls.map((u) => u.trim()).filter((u) => u.length > 0);

      if (urls.length === 0) {
        return {
          content: [
            { type: "text", text: "Invalid parameters: at least one valid URL is required" },
          ],
          details: { status: "error" as const, urls: [], results: [], failed: [] },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Extracting content from ${urls.length} URL(s)...` }],
        details: { status: "running", urls, query: params.query, results: [], failed: [] },
      });

      const result = await performExtract(params, signal, DEFAULT_DEPS);
      const text = formatWebExtractForLLM(result);

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },

    renderCall(
      args: WebExtractParamsType,
      theme: Theme,
      context: ToolRenderContext<unknown, WebExtractParamsType>,
    ): Component {
      return renderWebExtractCall(args, theme, context);
    },

    renderResult(
      result: AgentToolResult<ExtractState>,
      options: ToolRenderResultOptions,
      theme: Theme,
      context: ToolRenderContext<unknown, WebExtractParamsType>,
    ): Component {
      return renderWebExtractResult(result, options, theme, context);
    },
  });

  // --- web_crawl ---
  pi.registerTool({
    name: "web_crawl",
    label: "Web Crawl",
    description:
      "Crawl a site with Tavily and extract content from multiple pages.\n" +
      "Use `max_depth`, `limit`, and path or domain filters to control scope, plus `instructions` when you need semantic focus.",
    parameters: WebCrawlParams,

    async execute(
      _toolCallId: string,
      params: WebCrawlParamsType,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<CrawlState> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<CrawlState>> {
      const url = params.url?.trim();

      if (!url) {
        return {
          content: [{ type: "text", text: "Invalid parameters: URL is required" }],
          details: { status: "error" as const, url: "", results: [] },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Crawling ${url}...` }],
        details: { status: "running", url, instructions: params.instructions, results: [] },
      });

      const result = await performCrawl(params, signal, DEFAULT_DEPS);
      const text = formatWebCrawlForLLM(result);

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },

    renderCall(
      args: WebCrawlParamsType,
      theme: Theme,
      context: ToolRenderContext<unknown, WebCrawlParamsType>,
    ): Component {
      return renderWebCrawlCall(args, theme, context);
    },

    renderResult(
      result: AgentToolResult<CrawlState>,
      options: ToolRenderResultOptions,
      theme: Theme,
      context: ToolRenderContext<unknown, WebCrawlParamsType>,
    ): Component {
      return renderWebCrawlResult(result, options, theme, context);
    },
  });
}
