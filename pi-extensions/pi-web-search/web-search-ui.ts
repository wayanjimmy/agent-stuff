import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { SearchState } from "./web-search-client.ts";

export function renderWebSearchCall(args: any, theme: any): any {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  const searchDepth = typeof args?.search_depth === "string" ? args.search_depth : "basic";
  const topic = typeof args?.topic === "string" ? args.topic : "general";
  const preview = shorten(query.replace(/\s+/g, " ").trim(), 70);

  const title = theme.fg("toolTitle", theme.bold("web_search"));
  const scope = theme.fg("muted", `${topic} · ${searchDepth}`);
  const text = title + (preview ? `\n${scope} · ${preview}` : `\n${scope}`);
  return new Text(text, 0, 0);
}

export function renderWebSearchResult(
  result: any,
  opts: { expanded: boolean; isPartial: boolean },
  theme: any
): any {
  const state = result.details as SearchState | undefined;
  if (!state) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const status = opts.isPartial ? "running" : state.status;
  const icon = statusIcon(status, theme);
  const totalResults = state.results.length;

  const responseTimeInfo = state.responseTime
    ? ` · ${state.responseTime.toFixed(2)}s`
    : "";

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold("web_search ")) +
    theme.fg(
      "dim",
      `${totalResults} result${totalResults === 1 ? "" : "s"}${responseTimeInfo}`
    );

  if (status === "running") {
    let text = header;
    text += `\n\n${theme.fg("muted", "Searching Tavily…")}`;
    return new Text(text, 0, 0);
  }

  if (state.error) {
    let text = `${header}\n\n${theme.fg("error", state.error)}`;
    return new Text(text, 0, 0);
  }

  const assistantText = formatResults(state).trim() || "(no output)";

  if (!opts.expanded) {
    const allLines = assistantText.split("\n");
    const previewLines = allLines.slice(0, 18).join("\n");
    let text = `${header}\n\n${theme.fg("toolOutput", previewLines)}`;
    if (allLines.length > 18) {
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
    return new Text(text, 0, 0);
  }

  const mdTheme = getMarkdownTheme();
  const container = new Container();
  container.addChild(new Text(header, 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(new Markdown(assistantText, 0, 0, mdTheme));
  return container;
}

function statusIcon(status: string, theme: any): string {
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

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
