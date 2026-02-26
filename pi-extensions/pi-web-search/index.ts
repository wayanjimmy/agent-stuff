import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { WebSearchParams, type WebSearchParamsType } from "./web-search-params.js";
import { performSearch, type SearchState } from "./web-search-client.js";
import { renderWebSearchCall, renderWebSearchResult } from "./web-search-ui.js";
import { loadApiKeys } from "./api-key-manager.js";

/** Tool name constant for consistency */
const TOOL_NAME = "web_search";

/** Command name constant for consistency */
const COMMAND_NAME = "web-search-key";

/** Config file path */
const CONFIG_PATH = join(homedir(), ".pi", "extensions", "pi-web-search.json");

export default function webSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Web Search",
    description:
      "Search the web for current information using Tavily's search API. " +
      "Use this when you need up-to-date information that may not be in your training data, " +
      "such as recent news, current events, latest software versions, or specific facts. " +
      "The search_depth parameter controls thoroughness: 'basic' is faster, 'advanced' is more comprehensive. " +
      "The topic parameter can be set to 'news' for recent articles. " +
      "Supports multiple API keys via TAVILY_API_KEYS (comma-separated) for automatic rotation on rate limits",
    parameters: WebSearchParams,

    async execute(_toolCallId, rawParams, signal, onUpdate) {
      // TypeBox validates parameters before execution, but we cast for type safety
      const params = rawParams as WebSearchParamsType;
      const query = params.query?.trim() ?? "";

      if (query.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "Invalid parameters: query cannot be empty",
            },
          ],
          details: { status: "error", query: "", results: [] } satisfies SearchState,
          isError: true,
        };
      }

      const state: SearchState = {
        status: "running",
        query,
        results: [],
        startedAt: Date.now(),
      };

      // Initial update
      onUpdate?.({
        content: [{ type: "text", text: `Searching for "${query}"...` }],
        details: state,
      });

      const result = await performSearch(params, state, signal);

      const text = formatResults(result);

      return {
        content: [{ type: "text", text }],
        details: result,
        isError: result.status === "error",
      };
    },

    renderCall(args, theme) {
      return renderWebSearchCall(args, theme);
    },

    renderResult(result, opts, theme) {
      return renderWebSearchResult(result, opts, theme);
    },
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Configure Tavily API key for web search",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      if (!ctx.hasUI) {
        console.log("This command requires a UI. Please set TAVILY_API_KEY or TAVILY_API_KEYS environment variable instead");
        return;
      }

      // Show current key status
      const existingKeys = loadApiKeys();
      if (existingKeys.length > 0) {
        ctx.ui.notify(`Currently ${existingKeys.length} API key(s) configured via environment`, "info");
      }

      const apiKey = await ctx.ui.input({
        prompt: "Enter your Tavily API key (get one at https://tavily.com):",
        password: true,
      });

      if (!apiKey || apiKey.trim() === "") {
        ctx.ui.notify("No API key provided. Configuration cancelled", "warning");
        return;
      }

      const configDir = join(homedir(), ".pi", "extensions");

      try {
        // Read existing config if present
        let config: { apiKey?: string; apiKeys?: string[] } = {};
        try {
          const existing = await readFile(CONFIG_PATH, "utf-8");
          config = JSON.parse(existing);
        } catch {
          // No existing config
        }

        // Add new key to array
        if (!config.apiKeys) {
          config.apiKeys = [];
        }
        if (!config.apiKeys.includes(apiKey.trim())) {
          config.apiKeys.push(apiKey.trim());
        }

        await mkdir(configDir, { recursive: true });
        await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));

        ctx.ui.notify(
          `API key saved. ${config.apiKeys.length} key(s) in config. You can now use the ${TOOL_NAME} tool`,
          "success"
        );
      } catch (error) {
        ctx.ui.notify(
          `Failed to save API key: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error"
        );
      }
    },
  });
}

function formatResults(state: SearchState): string {
  const lines: string[] = [];
  lines.push(`## Search Results for "${state.query}"`);

  if (state.answer) {
    lines.push("\n### Summary");
    lines.push(state.answer);
  }

  if (state.results.length > 0) {
    lines.push(`\n### Results (${state.results.length} found)`);
    for (const item of state.results) {
      lines.push(`\n**[${item.title}](${item.url})**`);
      lines.push(item.content);
      if (item.raw_content) {
        lines.push("\n*Full content excerpt:*");
        lines.push(
          "> " + item.raw_content.slice(0, 500).replace(/\n/g, "\n> ")
        );
        if (item.raw_content.length > 500) {
          lines.push("> ...");
        }
      }
    }
  } else {
    lines.push("\nNo results found");
  }

  return lines.join("\n");
}
