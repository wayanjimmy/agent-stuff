import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

import type { CodexCommand, CodexRunState, CodexStatus } from "./codex-runner.ts";

export function renderCodexCall(args: any, theme: any): any {
  const task = typeof args?.task === "string" ? args.task.trim() : "";
  const sandbox = typeof args?.sandbox === "string" ? args.sandbox : "workspace-write";
  const preview = shorten(task.replace(/\s+/g, " ").trim(), 70);

  const title = theme.fg("toolTitle", theme.bold("codex_agent"));
  const scope = theme.fg("muted", `sandbox:${sandbox}`);
  const text = title + (preview ? `\n${scope} · ${preview}` : `\n${scope}`);
  return new Text(text, 0, 0);
}

export function renderCodexResult(
  result: any,
  opts: { expanded: boolean; isPartial: boolean },
  theme: any,
): any {
  const state = result.details as CodexRunState | undefined;
  if (!state) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const status: CodexStatus = opts.isPartial ? "running" : state.status;
  const icon = statusIcon(status, theme);
  const totalCommands = state.commands.length;

  const usageInfo = state.usage?.totalTokens
    ? ` · ${state.usage.totalTokens.toLocaleString()} tokens`
    : "";

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold("codex_agent ")) +
    theme.fg("dim", `${totalCommands} command${totalCommands === 1 ? "" : "s"}${usageInfo}`);

  const commandsText = renderCommands(state.commands, opts.expanded, theme);

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

    if (commandsText) text += `\n\n${commandsText}`;
    text += `\n\n${theme.fg("muted", "Running…")}`;
    return new Text(text, 0, 0);
  }

  const assistantText = state.lastAssistantMessage.trim() || "(no output)";

  if (state.error) {
    let text = `${header}\n\n${theme.fg("error", state.error)}`;
    if (commandsText) text += `\n\n${commandsText}`;
    return new Text(text, 0, 0);
  }

  if (!opts.expanded) {
    const allLines = assistantText.split("\n");
    const previewLines = allLines.slice(-18).join("\n");
    let text = `${header}\n\n${theme.fg("toolOutput", previewLines)}`;
    if (allLines.length > 18) {
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
    if (commandsText) text += `\n\n${commandsText}`;
    return new Text(text, 0, 0);
  }

  const mdTheme = getMarkdownTheme();
  const container = new Container();
  container.addChild(new Text(header, 0, 0));
  if (commandsText) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(commandsText, 0, 0));
  }
  container.addChild(new Spacer(1));
  container.addChild(new Markdown(assistantText, 0, 0, mdTheme));
  return container;
}

function statusIcon(status: CodexStatus, theme: any): string {
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

function renderCommands(commands: CodexCommand[], expanded: boolean, theme: any): string {
  if (commands.length === 0) return "";

  const visible = expanded ? commands : commands.slice(-6);
  const lines: string[] = [theme.fg("muted", "Commands:")];

  for (const cmd of visible) {
    const cmdIcon =
      cmd.exitCode !== undefined && cmd.exitCode !== 0
        ? theme.fg("error", "✗")
        : theme.fg("dim", "→");
    lines.push(`${cmdIcon} ${theme.fg("toolOutput", `bash ${shorten(cmd.command, 120)}`)}`);
  }

  if (!expanded && commands.length > 6) {
    lines.push(theme.fg("muted", "(Ctrl+O to expand)"));
  }

  return lines.join("\n");
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
