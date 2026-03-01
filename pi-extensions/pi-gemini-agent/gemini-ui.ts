import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

import type { GeminiRunState, GeminiStatus, GeminiToolCall } from "./gemini-runner.ts";

export function renderGeminiCall(args: any, theme: any): any {
  const task = typeof args?.task === "string" ? args.task.trim() : "";
  const mode = typeof args?.approvalMode === "string" ? args.approvalMode : "default";
  const preview = shorten(task.replace(/\s+/g, " ").trim(), 70);

  const title = theme.fg("toolTitle", theme.bold("gemini_agent"));
  const scope = theme.fg("muted", `mode:${mode}`);
  const text = title + (preview ? `\n${scope} · ${preview}` : `\n${scope}`);
  return new Text(text, 0, 0);
}

export function renderGeminiResult(
  result: any,
  opts: { expanded: boolean; isPartial: boolean },
  theme: any,
): any {
  const state = result.details as GeminiRunState | undefined;
  if (!state) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const status: GeminiStatus = opts.isPartial ? "running" : state.status;
  const icon = statusIcon(status, theme);
  const totalToolCalls = state.toolCalls.length;

  const usageInfo = state.usage?.totalTokens
    ? ` · ${state.usage.totalTokens.toLocaleString()} tokens`
    : "";

  const modelInfo = state.model ? ` · ${theme.fg("muted", state.model)}` : "";

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold("gemini_agent ")) +
    theme.fg(
      "dim",
      `${totalToolCalls} tool call${totalToolCalls === 1 ? "" : "s"}${usageInfo}${modelInfo}`,
    );

  const toolsText = renderToolCalls(state.toolCalls, opts.expanded, theme);

  if (status === "running") {
    let text = header;

    if (state.lastAssistantMessage) {
      const lines = state.lastAssistantMessage.split("\n");
      const preview = lines.slice(-20).join("\n");
      text += `\n\n${theme.fg("toolOutput", preview)}`;
    }

    if (state.stderrTail.length > 0) {
      const tail = state.stderrTail.slice(-5).join("\n");
      text += `\n\n${theme.fg("error", tail)}`;
    }

    if (toolsText) text += `\n\n${toolsText}`;
    text += `\n\n${theme.fg("muted", "Running…")}`;
    return new Text(text, 0, 0);
  }

  const assistantText = state.lastAssistantMessage.trim() || "(no output)";

  if (state.error) {
    let text = `${header}\n\n${theme.fg("error", state.error)}`;
    if (toolsText) text += `\n\n${toolsText}`;
    return new Text(text, 0, 0);
  }

  if (!opts.expanded) {
    const allLines = assistantText.split("\n");
    const previewLines = allLines.slice(-18).join("\n");
    let text = `${header}\n\n${theme.fg("toolOutput", previewLines)}`;
    if (allLines.length > 18) {
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
    if (toolsText) text += `\n\n${toolsText}`;
    return new Text(text, 0, 0);
  }

  const mdTheme = getMarkdownTheme();
  const container = new Container();
  container.addChild(new Text(header, 0, 0));
  if (toolsText) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(toolsText, 0, 0));
  }
  container.addChild(new Spacer(1));
  container.addChild(new Markdown(assistantText, 0, 0, mdTheme));
  return container;
}

function statusIcon(status: GeminiStatus, theme: any): string {
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

function renderToolCalls(calls: GeminiToolCall[], expanded: boolean, theme: any): string {
  if (calls.length === 0) return "";

  const visible = expanded ? calls : calls.slice(-6);
  const lines: string[] = [theme.fg("muted", "Tools:")];

  for (const call of visible) {
    const callIcon = call.isError ? theme.fg("error", "✗") : theme.fg("dim", "→");
    lines.push(`${callIcon} ${theme.fg("toolOutput", formatToolCall(call))}`);
  }

  if (!expanded && calls.length > 6) {
    lines.push(theme.fg("muted", "(Ctrl+O to expand)"));
  }

  return lines.join("\n");
}

function formatToolCall(call: GeminiToolCall): string {
  const input =
    call.input && typeof call.input === "object" ? (call.input as Record<string, any>) : undefined;

  if (call.name === "read_file" || call.name === "read") {
    const p =
      typeof input?.path === "string" ? input.path :
      typeof input?.file_path === "string" ? input.file_path :
      typeof input?.filepath === "string" ? input.filepath : "";
    return `${call.name} ${shorten(p, 100)}`;
  }

  if (call.name === "run_shell_command" || call.name === "bash") {
    const cmd = typeof input?.command === "string" ? input.command : "";
    return `${call.name} ${shorten(cmd.replace(/\s+/g, " ").trim(), 80)}`;
  }

  if (call.name === "save_file" || call.name === "write") {
    const p =
      typeof input?.path === "string"
        ? input.path
        : typeof input?.file_path === "string"
          ? input.file_path
          : typeof input?.filepath === "string"
            ? input.filepath
            : "";
    return `${call.name} ${shorten(p, 100)}`;
  }

  // For other tools, show tool name and a summary of input parameters
  if (input && Object.keys(input).length > 0) {
    const inputSummary = Object.entries(input)
      .slice(0, 2)
      .map(([k, v]) => {
        const strVal = String(v);
        return `${k}=${shorten(strVal.length > 30 ? strVal.slice(0, 30) : strVal, 20)}`;
      })
      .join(" ");
    return `${call.name} ${inputSummary}${Object.keys(input).length > 2 ? "…" : ""}`;
  }

  return call.name;
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
