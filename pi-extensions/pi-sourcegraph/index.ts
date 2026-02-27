/**
 * Sourcegraph Extension for PI
 *
 * Enables the AI agent to search public codebases using Sourcegraph.
 * Perfect for finding implementations, patterns, and usage examples.
 *
 * Installation:
 *   cp -r pi-sourcegraph ~/.pi/agent/extensions/
 *
 * Usage:
 *   Agent can call: "Search for rate limiting patterns in Go"
 *   User command: /sourcegraph "lang:typescript redux middleware"
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";

// ============================================
// Types
// ============================================

interface LineMatch {
  line: string;
  lineNumber: number;
}

interface SearchMatch {
  repo: string;
  path: string;
  url: string;
  lineMatches: LineMatch[];
}

interface SearchResult {
  query: string;
  matches: SearchMatch[];
  stats: { matchCount: number; resultCount: number; elapsed: string };
}

// ============================================
// Sourcegraph API Client
// ============================================

const SOURCEGRAPH_API_URL = "https://sourcegraph.com/.api/graphql";

// Simplified query - only FileMatch is supported by current API
const SEARCH_QUERY = `
query Search($query: String!) {
  search(query: $query, version: V3) {
    results {
      matchCount
      resultCount
      elapsedMilliseconds
      results {
        __typename
        ... on FileMatch {
          repository { name }
          file { path url }
          lineMatches { preview lineNumber }
        }
      }
    }
  }
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Parse GraphQL response into SearchResult
 */
function parseSearchResponse(json: any, originalQuery: string, contextWindow: number): SearchResult {
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }

  const results = json.data?.search?.results;
  if (!results) {
    return {
      query: originalQuery,
      matches: [],
      stats: { matchCount: 0, resultCount: 0, elapsed: "0ms" },
    };
  }

  const matches: SearchMatch[] = [];

  // Process FileMatch results only
  for (const result of results.results || []) {
    if (result.__typename === "FileMatch") {
      if (!result.repository || !result.file || !result.lineMatches) continue;

      const lineMatches: LineMatch[] = result.lineMatches
        .slice(0, contextWindow > 0 ? contextWindow * 2 + 1 : 5)
        .map((lm: { preview: string; lineNumber: number }) => ({
          line: lm.preview,
          lineNumber: lm.lineNumber,
        }));

      matches.push({
        repo: result.repository.name,
        path: result.file.path,
        url: `https://sourcegraph.com${result.file.url}`,
        lineMatches,
      });
    }
  }

  return {
    query: originalQuery,
    matches,
    stats: {
      matchCount: results.matchCount ?? 0,
      resultCount: results.resultCount ?? 0,
      elapsed: `${results.elapsedMilliseconds ?? 0}ms`,
    },
  };
}

/**
 * Search using curl as a fallback when fetch is unavailable or fails.
 * More reliable in some environments and provides better error diagnostics.
 */
async function searchWithCurl(
  query: string,
  count: number,
  contextWindow: number,
  timeoutMs: number,
): Promise<SearchResult> {
  const requestBody = JSON.stringify({
    query: SEARCH_QUERY,
    variables: {
      query: `${query} count:${count}`,
    },
  });

  return new Promise((resolve, reject) => {
    const args = [
      "-s", // silent mode
      "-S", // show errors
      "-L", // follow redirects
      "-m", `${Math.ceil(timeoutMs / 1000)}`, // max time in seconds
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: pi-sourcegraph/1.0 (curl)",
      "-d", requestBody,
      SOURCEGRAPH_API_URL,
    ];

    const proc = spawn("curl", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`curl spawn failed: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exited with code ${code}: ${stderr || "unknown error"}`));
        return;
      }

      try {
        const json = JSON.parse(stdout);
        resolve(parseSearchResponse(json, query, contextWindow));
      } catch (parseError) {
        reject(new Error(`Failed to parse curl response: ${parseError}. Response: ${stdout.slice(0, 200)}`));
      }
    });

    // Manual timeout
    setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("curl request timed out"));
    }, timeoutMs);
  });
}

/**
 * Search using native fetch API.
 */
async function searchWithFetch(
  query: string,
  count: number,
  contextWindow: number,
  timeoutMs: number,
): Promise<SearchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(SOURCEGRAPH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "pi-sourcegraph/1.0 (fetch)",
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          query: `${query} count:${count}`,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    return parseSearchResponse(json, query, contextWindow);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Main search function with fallback from fetch to curl.
 * Tries fetch first, then falls back to curl if fetch fails or is unavailable.
 */
async function searchSourcegraph(
  query: string,
  count: number,
  contextWindow: number,
  timeoutMs: number,
): Promise<SearchResult> {
  const errors: string[] = [];

  // Try fetch first
  try {
    return await searchWithFetch(query, count, contextWindow, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`fetch: ${message}`);

    // If fetch failed due to AbortError (timeout), don't try curl
    if (message.includes("abort") || message.includes("AbortError")) {
      throw new Error(`Search timed out after ${timeoutMs}ms`);
    }
  }

  // Fallback to curl
  try {
    return await searchWithCurl(query, count, contextWindow, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`curl: ${message}`);
  }

  // Both methods failed
  throw new Error(`All search methods failed: ${errors.join("; ")}`);
}

function formatResult(result: SearchResult): string {
  if (result.matches.length === 0) {
    return `No results found for query: "${result.query}"`;
  }

  const lines: string[] = [
    `Found ${result.stats.matchCount} matches in ${result.stats.resultCount} files (${result.stats.elapsed})`,
    "",
  ];

  for (const match of result.matches) {
    lines.push(`## ${match.repo} - ${match.path}`);
    lines.push(`[View on Sourcegraph](${match.url})`);
    lines.push("");

    // Show line matches
    if (match.lineMatches.length > 0) {
      lines.push("```");
      for (const lm of match.lineMatches) {
        const prefix = lm.lineNumber === 0 ? "" : `${lm.lineNumber}: `;
        lines.push(`${prefix}${lm.line}`);
      }
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================
// PI Extension
// ============================================

export default function (pi: ExtensionAPI) {
  // Inject helpful instructions into the system prompt
  pi.on("before_agent_start", async (_event, _ctx) => {
    return {
      message: {
        customType: "sourcegraph-intro",
        content: `
You have access to the **sourcegraph** tool for searching public codebases via Sourcegraph.

**When to use it:**
- Finding implementation patterns or examples
- Researching how specific projects solve problems
- Discovering APIs and their usage patterns
- Cross-referencing similar implementations across repositories
- Understanding how a specific library or framework is used in practice

**Query construction best practices:**
- Start SIMPLE - avoid complex regex patterns that timeout
- Use common import aliases: \`sq.Select\` not \`squirrel\.Select\`
- Always add language filter: \`lang:typescript\`, \`lang:go\`, etc.
- Exclude noise: \`-file:vendor\`, \`-file:test\`, \`-file:_test\\.go$\`
- Use direct patterns: \`sq.Select\` not \`sq\.Select|sq\.Insert\`
- Keep queries under 30 seconds - simplify if timing out

**Effective search patterns:**
- Usage by alias: \`sq.Select lang:go -file:vendor\`
- CRUD operations: \`sq.Insert lang:go\`, \`sq.Update lang:go\`, \`sq.Delete lang:go\`
- Conditionals: \`sq.Eq lang:go -file:vendor\`, \`sq.Where lang:go\`
- Exact phrases: \`"useState" lang:typescript\`
- Repository-specific: \`repo:^github\\.com/org/repo$\` (but prefer broad search first)

**Query optimization checklist:**
1. Start with simple patterns (no complex regex OR operators)
2. Include language filter: \`lang:go\`
3. Exclude noise: \`-file:vendor\` for Go, \`-file:test\` for production code
4. Use common aliases: \`sq\` not full package name
5. If timing out: simplify query or remove filters
6. Context window: 3-5 lines provides good balance

**Examples:**
- \`sq.Select lang:go -file:vendor\` - Find squirrel query builder usage
- \`useState lang:typescript -file:test\` - Find React useState patterns
- \`lang:go rate limiting middleware\` - Find rate limiting implementations
- \`"with open" lang:python -file:test\` - Find file handling patterns
- \`lang:typescript redux middleware\` - Find Redux middleware patterns

**What to avoid:**
- Complex regex: \`a\.X\|b\.Y\|c\.Z\` - search separately instead
- Over-escaped dots: \`squirrel\.Select\` - use \`squirrel.Select\`
- Too specific without repo: \`PlaceholderFormat lang:go\` - add repo or simplify
- Multiple combined filters: start simple, then narrow down

The tool returns code snippets with context and verifiable Sourcegraph links. Use these links to cite evidence in your responses.
        `.trim(),
        display: false,
      },
    };
  });

  // Register the sourcegraph tool
  pi.registerTool({
    name: "sourcegraph",
    label: "Sourcegraph",
    description: "Search public codebases using Sourcegraph to find implementations, patterns, and usage examples. Supports filters like lang:, repo:, file:, etc.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Sourcegraph search query. Use SIMPLE patterns: 'sq.Select lang:go -file:vendor', 'useState lang:typescript', 'lang:go rate limiting'. Avoid complex regex OR operators.",
      }),
      count: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (1-20, default 10). First page often has most relevant results.",
          minimum: 1,
          maximum: 20,
        }),
      ),
      contextWindow: Type.Optional(
        Type.Number({
          description: "Number of surrounding lines to show per match (0-10, default 3). Sweet spot: 3-5 lines for understanding patterns.",
          minimum: 0,
          maximum: 10,
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, _ctx) {
      const query = params.query.trim();
      const count = clamp(params.count ?? 10, 1, 20);
      const contextWindow = clamp(params.contextWindow ?? 3, 0, 10);
      const timeout = 30000; // 30 seconds

      // Report progress
      onUpdate?.({
        content: [{ type: "text", text: `Searching Sourcegraph: "${query}"...` }],
      });

      try {
        const result = await searchSourcegraph(query, count, contextWindow, timeout);

        return {
          content: [{ type: "text", text: formatResult(result) }],
          details: {
            query: result.query,
            matchCount: result.stats.matchCount,
            resultCount: result.stats.resultCount,
            elapsed: result.stats.elapsed,
            matches: result.matches,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.includes("abort") || message.includes("timeout");

        if (isTimeout) {
          return {
            content: [
              {
                type: "text",
                text: `Search timed out after 30s. Try a more specific query with filters like 'lang:' or 'repo:'.`,
              },
            ],
            details: { error: "timeout", query },
          };
        } else {
          // Provide more helpful error messages for common failures
          let helpText = "";
          if (message.includes("fetch") && message.includes("curl")) {
            helpText = " Both fetch and curl failed. Please check your network connection.";
          } else if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
            helpText = " DNS lookup failed. Check your internet connection.";
          } else if (message.includes("ECONNREFUSED")) {
            helpText = " Connection refused. Sourcegraph may be temporarily unavailable.";
          }

          return {
            content: [{ type: "text", text: `Search failed: ${message}${helpText}` }],
            details: { error: message, query },
          };
        }
      }
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("sourcegraph ")) + theme.fg("muted", args.query);
      if (args.count) {
        text += " " + theme.fg("dim", `(count: ${args.count})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as
        | { query?: string; matchCount?: number; resultCount?: number; elapsed?: string; matches?: SearchMatch[] }
        | undefined;

      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      // Error state
      if ("error" in details) {
        return new Text(
          theme.fg("error", `✗ Failed`) +
            (details.query ? ` ${theme.fg("dim", `for "${details.query}"`)}` : ""),
          0,
          0,
        );
      }

      // Success state
      const matchCount = details.matchCount ?? 0;
      const resultCount = details.resultCount ?? 0;
      const elapsed = details.elapsed ?? "";

      let text =
        theme.fg("success", "✓ Found ") +
        theme.fg("accent", `${matchCount} matches`) +
        theme.fg("muted", ` in ${resultCount} files`) +
        (elapsed ? ` ${theme.fg("dim", `(${elapsed})`)}` : "");

      if (expanded && details.matches && details.matches.length > 0) {
        text += "\n";
        const display = details.matches.slice(0, 10); // Show max 10 in expanded view
        for (const match of display) {
          text += "\n" + theme.fg("dim", "  • ") + theme.fg("muted", `${match.repo}/${match.path}`);
        }
        if (details.matches.length > 10) {
          text += "\n" + theme.fg("dim", `  ... ${details.matches.length - 10} more`);
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // Register a /sourcegraph command for manual searches
  pi.registerCommand("sourcegraph", {
    description: "Search Sourcegraph for code patterns and examples",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("Usage: /sourcegraph <query>", "info");
        ctx.ui.notify("Example: /sourcegraph sq.Select lang:go -file:vendor", "info");
        ctx.ui.notify("Tips: Use simple patterns, exclude -file:vendor, add lang: filter", "info");
        return;
      }

      // Send as user message so the agent can process it
      pi.sendUserMessage(`Search Sourcegraph for: ${args}`);
    },
  });

  // Register a /sg-help command for query optimization tips
  pi.registerCommand("sg-help", {
    description: "Show Sourcegraph query optimization tips",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("sg-help requires interactive mode", "error");
        return;
      }

      const tips = [
        "",
        "Sourcegraph Query Optimization Tips",
        "",
        "DO: Use simple patterns",
        "   sq.Select lang:go -file:vendor",
        "",
        "DON'T: Complex regex OR",
        "   sq.Select|sq.Insert|sq.Update",
        "",
        "DO: Search separately",
        "   sq.Select lang:go",
        "   sq.Insert lang:go",
        "",
        "DO: Use common aliases",
        "   sq.Select (not squirrel.Select)",
        "",
        "DO: Always exclude noise",
        "   -file:vendor (Go)",
        "   -file:test (all languages)",
        "   -file:_test.go (Go tests)",
        "",
        "DO: Add language filter",
        "   lang:go, lang:typescript, lang:python",
        "",
        "If query times out (>30s):",
        "   - Simplify the pattern",
        "   - Remove complex filters",
        "   - Search separately instead of OR",
        "",
        "Context window: 3-5 lines is best",
        "   - Too low (1-2): insufficient context",
        "   - Too high (10+): too much noise",
        "",
        "Search strategy:",
        "   1. Start broad: sq.Select lang:go -file:vendor",
        "   2. Narrow: sq.Insert lang:go",
        "   3. Explore repos via Sourcegraph links",
        "",
        "Examples:",
        "   /sourcegraph sq.Select lang:go -file:vendor",
        "   /sourcegraph useState lang:typescript -file:test",
        "   /sourcegraph lang:python flask route",
        "",
      ].join("\n");

      // Show tips in a custom UI
      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        const text = new Text(theme.fg("accent", tips), 1, 1);

        text.onKey = (key) => {
          if (key === "escape" || key === "return" || key === "space") {
            done();
          }
          return true;
        };

        return text;
      });
    },
  });

  // Notify on load
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.notify("Sourcegraph extension loaded", "info");
    }
  });
}
