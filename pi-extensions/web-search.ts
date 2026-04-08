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
import { Type, type Static } from "@sinclair/typebox";
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

async function parseTavilyError(response: Response): Promise<string> {
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
  return errorMessage;
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

function statusIcon(status: string, theme: Theme): string {
  switch (status) {
    case "done":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "aborted":
      return theme.fg("warning", "◼");
    default:
      return theme.fg("warning", "⏳");
  }
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
}

interface SearchState {
  status: "running" | "done" | "error" | "aborted";
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  responseTime?: number;
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

// ---------------------------------------------------------------------------
// Search transport
// ---------------------------------------------------------------------------

const TAVILY_SEARCH_API_URL = "https://api.tavily.com/search";

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
    query: objective,
    search_depth: "basic" as const,
    max_results: params.max_results ?? 8,
    include_answer: true,
    include_raw_content: false,
    topic: params.topic ?? "general",
    ...(params.search_queries?.length ? { search_queries: params.search_queries } : {}),
  };

  try {
    const response = await deps.fetchFn(TAVILY_SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    throwIfAborted(signal);

    if (!response.ok) {
      const errorMessage = await parseTavilyError(response);
      return { status: "error", query: objective, results: [], error: errorMessage };
    }

    const data = (await response.json()) as TavilySearchResponse;
    throwIfAborted(signal);

    return {
      status: "done",
      query: data.query,
      answer: data.answer,
      results: data.results,
      responseTime: data.response_time,
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
  const objective = args.objective?.trim() || args.query?.trim() || "";
  const topic = args.topic ?? "general";
  const preview = objective.length > 70 ? `${objective.slice(0, 70)}…` : objective;

  let text = theme.fg("toolTitle", theme.bold("web_search"));
  if (preview) {
    text += `\n${theme.fg("muted", topic)} · ${theme.fg("dim", preview)}`;
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
  const icon = statusIcon(status, theme);
  const totalResults = state.results.length;
  const responseTimeInfo = state.responseTime ? ` · ${state.responseTime.toFixed(2)}s` : "";

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold("web_search")) +
    theme.fg("dim", `${totalResults} result${totalResults === 1 ? "" : "s"}${responseTimeInfo}`);

  if (status === "running") {
    return new Text(`${header}\n\n${theme.fg("dim", "Searching Tavily…")}`, 0, 0);
  }

  if (state.error) {
    return new Text(`${header}\n\n${theme.fg("error", state.error)}`, 0, 0);
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
  chunks_per_source: Type.Optional(
    Type.Number({
      description: "Number of relevant chunks per URL (1-5). Requires 'query' to be set.",
      minimum: 1,
      maximum: 5,
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
  const lines: string[] = [];

  if (state.query) {
    lines.push(`### Extracted content (query: "${state.query}")`);
  } else {
    lines.push("### Extracted content");
  }

  if (state.results.length === 0) {
    lines.push("\nNo content extracted.");
    if (state.failed.length > 0) {
      lines.push(`\n${state.failed.length} URL(s) failed to extract.`);
    }
    return lines.join("\n");
  }

  lines.push(`\n${state.results.length} URL(s) processed successfully.`);

  for (const item of state.results) {
    lines.push(`\n**${item.title}**`);
    lines.push(`${item.url}\n`);
    lines.push(item.content);
  }

  if (state.failed.length > 0) {
    lines.push(`\n---\n**Failed URLs (${state.failed.length}):**`);
    for (const f of state.failed) {
      lines.push(`- ${f.url}${f.error ? `: ${f.error}` : ""}`);
    }
  }

  return lines.join("\n");
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

  // Validate chunks_per_source requires query
  if (params.chunks_per_source && !params.query?.trim()) {
    return {
      status: "error",
      urls,
      results: [],
      failed: [],
      error: "'chunks_per_source' requires 'query' to be set",
    };
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
  if (params.chunks_per_source) {
    body.chunks_per_source = params.chunks_per_source;
  }

  try {
    const response = await deps.fetchFn(TAVILY_EXTRACT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    throwIfAborted(signal);

    if (!response.ok) {
      const errorMessage = await parseTavilyError(response);
      return { status: "error", urls, results: [], failed: [], error: errorMessage };
    }

    const data = (await response.json()) as TavilyExtractResponse;
    throwIfAborted(signal);

    // Normalize results
    const results: ExtractResult[] = (data.results || []).map((r) => ({
      url: r.url,
      title: extractTitle(r.url),
      content: r.raw_content || "",
    }));

    return {
      status: "done",
      urls,
      query: params.query?.trim(),
      results,
      failed: data.failed || [],
      responseTime: data.response_time,
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
  const icon = statusIcon(status, theme);
  const successCount = state.results.length;
  const failedCount = state.failed.length;
  const responseTimeInfo = state.responseTime ? ` · ${state.responseTime.toFixed(2)}s` : "";

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold("web_extract")) +
    theme.fg("dim", `${successCount} succeeded${failedCount > 0 ? `, ${failedCount} failed` : ""}${responseTimeInfo}`);

  if (status === "running") {
    return new Text(`${header}\n\n${theme.fg("dim", "Extracting content with Tavily…")}`, 0, 0);
  }

  if (state.error) {
    return new Text(`${header}\n\n${theme.fg("error", state.error)}`, 0, 0);
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
      description: "Maximum crawl depth (1-5)",
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
      default: 20,
    }),
  ),
  instructions: Type.Optional(
    Type.String({
      description: "Natural language guidance for semantic focus",
    }),
  ),
  chunks_per_source: Type.Optional(
    Type.Number({
      description: "Number of relevant chunks per page (1-5). Requires 'instructions' to be set.",
      minimum: 1,
      maximum: 5,
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
  extract_depth: Type.Optional(
    Type.Union([Type.Literal("basic"), Type.Literal("advanced")], {
      description: "Use 'advanced' for JavaScript-heavy pages",
      default: "basic",
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
  const lines: string[] = [];

  if (state.instructions) {
    lines.push(`### Crawled content (instructions: "${state.instructions}")`);
  } else {
    lines.push("### Crawled content");
  }

  lines.push(`\nRoot URL: ${state.url}`);

  if (state.results.length === 0) {
    lines.push("\nNo pages crawled.");
    return lines.join("\n");
  }

  lines.push(`${state.results.length} page(s) extracted.\n`);

  for (const item of state.results) {
    lines.push(`**${item.title}**`);
    lines.push(`${item.url}\n`);
    lines.push(item.content);
    lines.push("");
  }

  return lines.join("\n");
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

  // Validate chunks_per_source requires instructions
  if (params.chunks_per_source && !params.instructions?.trim()) {
    return {
      status: "error",
      url,
      results: [],
      error: "'chunks_per_source' requires 'instructions' to be set",
    };
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
    limit: params.limit ?? 20,
    extract_depth: params.extract_depth ?? "basic",
    format: "markdown",
  };

  if (params.max_breadth) {
    body.max_breadth = params.max_breadth;
  }
  if (params.instructions?.trim()) {
    body.instructions = params.instructions.trim();
  }
  if (params.chunks_per_source) {
    body.chunks_per_source = params.chunks_per_source;
  }
  if (params.select_paths?.length) {
    body.select_paths = params.select_paths;
  }
  if (params.exclude_paths?.length) {
    body.exclude_paths = params.exclude_paths;
  }

  try {
    const response = await deps.fetchFn(TAVILY_CRAWL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    throwIfAborted(signal);

    if (!response.ok) {
      const errorMessage = await parseTavilyError(response);
      return { status: "error", url, results: [], error: errorMessage };
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
  const limit = args.limit ?? 20;
  const instructions = args.instructions?.trim() ?? "";

  const urlPreview = url.length > 50 ? `${url.slice(0, 50)}…` : url;

  let text = theme.fg("toolTitle", theme.bold("web_crawl"));
  text += `\n${theme.fg("muted", `depth ${depth}`)} · ${theme.fg("dim", `limit ${limit}`)}`;
  if (urlPreview) {
    text += `\n${theme.fg("dim", urlPreview)}`;
  }
  if (instructions) {
    const instrPreview =
      instructions.length > 50 ? `${instructions.slice(0, 50)}…` : instructions;
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
  const icon = statusIcon(status, theme);
  const pageCount = state.results.length;
  const responseTimeInfo = state.responseTime ? ` · ${state.responseTime.toFixed(2)}s` : "";

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold("web_crawl")) +
    theme.fg("dim", `${pageCount} page${pageCount === 1 ? "" : "s"}${responseTimeInfo}`);

  if (status === "running") {
    return new Text(`${header}\n\n${theme.fg("dim", "Crawling site with Tavily…")}`, 0, 0);
  }

  if (state.error) {
    return new Text(`${header}\n\n${theme.fg("error", state.error)}`, 0, 0);
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
      params: WebSearchParamsType,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<SearchState> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<SearchState>> {
      const objective = params.objective?.trim() || params.query?.trim() || "";

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
      "Extract clean markdown content from specific URLs using Tavily's extract API.\n" +
      "Use when you have URLs and need their content, handles JavaScript-rendered pages.\n\n" +
      "- Provide `urls` (1-20) to extract content from.\n" +
      "- Use `extract_depth: 'advanced'` for JavaScript-heavy pages.\n" +
      "- Use `query` + `chunks_per_source` for relevance-focused extraction.\n\n" +
      "Examples:\n" +
      '  {"urls":["https://docs.example.com/api"]}\n' +
      '  {"urls":["https://app.example.com/dashboard"],"extract_depth":"advanced"}\n' +
      '  {"urls":["https://docs.example.com"],"query":"authentication","chunks_per_source":3}',
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
          content: [{ type: "text", text: "Invalid parameters: at least one valid URL is required" }],
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
      "Crawl a website and extract content from multiple pages using Tavily's crawl API.\n" +
      "Use when you need content from many pages on a site (e.g., documentation, articles).\n\n" +
      "- Provide a `url` as the starting point.\n" +
      "- Use `max_depth` (1-5) and `limit` to control scope.\n" +
      "- Use `instructions` for semantic focus on relevant content.\n" +
      "- Use `select_paths`/`exclude_paths` to filter which URLs to crawl.\n\n" +
      "Examples:\n" +
      '  {"url":"https://docs.example.com","max_depth":2,"limit":30}\n' +
      '  {"url":"https://docs.example.com","instructions":"API authentication endpoints","chunks_per_source":3}\n' +
      '  {"url":"https://example.com","select_paths":["/docs/.*","/api/.*"],"exclude_paths":["/blog/.*"]}',
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