import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { WebSearchParams } from "./web-search-params.ts";
import { performSearch, type SearchState } from "./web-search-client.ts";
import { renderWebSearchCall, renderWebSearchResult } from "./web-search-ui.ts";

export default function webSearchExtension(pi: ExtensionAPI) {
  // Register the web_search tool
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information using Tavily's search API. " +
      "Use this when you need up-to-date information that may not be in your training data, " +
      "such as recent news, current events, latest software versions, or specific facts. " +
      "The search_depth parameter controls thoroughness: 'basic' is faster, 'advanced' is more comprehensive. " +
      "The topic parameter can be set to 'news' for recent articles.",
    parameters: WebSearchParams,

    async execute(_toolCallId, params, signal, onUpdate) {
      const query =
        typeof (params as any).query === "string"
          ? ((params as any).query as string).trim()
          : "";

      if (!query) {
        return {
          content: [
            {
              type: "text",
              text: "Invalid parameters: expected `query` to be a non-empty string.",
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

      const result = await performSearch(params as any, state, signal);

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

  // Register /web-search-key command for API key configuration
  pi.registerCommand("web-search-key", {
    description: "Configure Tavily API key for web search",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      if (!ctx.hasUI) {
        console.log("This command requires a UI. Please set TAVILY_API_KEY environment variable instead.");
        return;
      }

      const apiKey = await ctx.ui.input({
        prompt: "Enter your Tavily API key (get one at https://tavily.com):",
        password: true,
      });

      if (!apiKey || apiKey.trim() === "") {
        ctx.ui.notify("No API key provided. Configuration cancelled.", "warning");
        return;
      }

      // Save to config file
      const configDir = join(homedir(), ".pi", "extensions");
      const configPath = join(configDir, "pi-web-search.json");

      try {
        await mkdir(configDir, { recursive: true });
        await writeFile(
          configPath,
          JSON.stringify({ apiKey: apiKey.trim() }, null, 2)
        );
        ctx.ui.notify(
          `API key saved to ${configPath}. You can now use the web_search tool.`,
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
    lines.push("\nNo results found.");
  }

  return lines.join("\n");
}
