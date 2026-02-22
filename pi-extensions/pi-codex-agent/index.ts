import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { CodexAgentParams } from "./codex-params.ts";
import { runCodexAgent, type CodexRunState } from "./codex-runner.ts";
import { renderCodexCall, renderCodexResult } from "./codex-ui.ts";

export default function codexAgentExtension(pi: ExtensionAPI) {
  // Common tool execute logic
  async function executeCodex(
    params: Record<string, any>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: any) => void) | undefined,
    forceSandbox?: string,
  ) {
    const task = typeof params.task === "string" ? params.task.trim() : "";
    if (!task) {
      return {
        content: [{ type: "text", text: "Invalid parameters: `task` must be a non-empty string." }],
        isError: true,
      };
    }

    const sandbox =
      forceSandbox ?? (typeof params.sandbox === "string" ? params.sandbox : undefined);

    const result = await runCodexAgent({
      task,
      cwd: typeof params.cwd === "string" ? params.cwd : undefined,
      sandbox,
      model: typeof params.model === "string" ? params.model : undefined,
      profile: typeof params.profile === "string" ? params.profile : undefined,
      fullAuto: params.full_auto === true,
      addDirs: Array.isArray(params.add_dir) ? params.add_dir : undefined,
      workspaceRoot: process.cwd(),
      signal: signal ?? undefined,
      onUpdate: (s) => {
        onUpdate?.({
          content: [{ type: "text", text: s.lastAssistantMessage || "(running…)" }],
          details: s,
        });
      },
    });

    const text = result.lastAssistantMessage.trim() || result.error || "(no output)";

    return {
      content: [{ type: "text", text }],
      details: result,
      isError: result.status === "error",
    };
  }

  // Main codex_agent tool (configurable sandbox)
  pi.registerTool({
    name: "codex_agent",
    label: "Codex Agent",
    description:
      "Delegate a coding task to the Codex CLI agent. The agent runs as a subprocess via `codex exec` and can read files, run commands, and edit code. Use for tasks that benefit from a separate agent context.",
    parameters: CodexAgentParams,

    async execute(_toolCallId, params, signal, onUpdate) {
      return executeCodex(params as Record<string, any>, signal, onUpdate);
    },

    renderCall(args, theme) {
      return renderCodexCall(args, theme);
    },

    renderResult(result, opts, theme) {
      return renderCodexResult(result, opts, theme);
    },
  });

  // Read-only variant (hard-coded sandbox for review/planner modes)
  pi.registerTool({
    name: "codex_agent_readonly",
    label: "Codex Agent (Read-Only)",
    description:
      "Delegate a read-only task to the Codex CLI agent. The sandbox is hard-coded to 'read-only' for safety. Use for code review, planning, and analysis tasks.",
    parameters: CodexAgentParams,

    async execute(_toolCallId, params, signal, onUpdate) {
      return executeCodex(params as Record<string, any>, signal, onUpdate, "read-only");
    },

    renderCall(args, theme) {
      return renderCodexCall({ ...args, sandbox: "read-only" }, theme);
    },

    renderResult(result, opts, theme) {
      return renderCodexResult(result, opts, theme);
    },
  });

  // /codex — general delegation
  pi.registerCommand("codex", {
    description: "Delegate a task to the Codex CLI agent. Usage: /codex <task>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      let task = args.trim();

      if (!task && ctx.hasUI) {
        task = ctx.ui.getEditorText().trim();
        if (task) ctx.ui.setEditorText("");
      }

      if (!task) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /codex <task>", "warning");
        }
        return;
      }

      await ctx.waitForIdle();
      pi.sendUserMessage(
        `Use the codex_agent tool with sandbox "workspace-write" for this task: ${task}`,
      );
    },
  });

  // /codex-reviewer — read-only code review
  pi.registerCommand("codex-reviewer", {
    description: "Use Codex as a code reviewer. Usage: /codex-reviewer <task>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      let task = args.trim();

      if (!task && ctx.hasUI) {
        task = ctx.ui.getEditorText().trim();
        if (task) ctx.ui.setEditorText("");
      }

      if (!task) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /codex-reviewer <task>", "warning");
        }
        return;
      }

      const reviewPrompt = [
        "You are a thorough code reviewer. Focus on:",
        "- Correctness and potential bugs",
        "- Security vulnerabilities",
        "- Edge cases and error handling",
        "- Provide actionable feedback with minimal diffs",
        "",
        `Review task: ${task}`,
      ].join("\n");

      await ctx.waitForIdle();
      pi.sendUserMessage(`Use the codex_agent_readonly tool for this task:\n\n${reviewPrompt}`);
    },
  });

  // /codex-planner — read-only planning
  pi.registerCommand("codex-planner", {
    description: "Use Codex as a planner. Usage: /codex-planner <task>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      let task = args.trim();

      if (!task && ctx.hasUI) {
        task = ctx.ui.getEditorText().trim();
        if (task) ctx.ui.setEditorText("");
      }

      if (!task) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /codex-planner <task>", "warning");
        }
        return;
      }

      const planPrompt = [
        "You are a technical planner. Produce a structured plan including:",
        "- Clear milestones and deliverables",
        "- Risk assessment and mitigation",
        "- Test strategy",
        "- Follow KISS and YAGNI principles",
        "",
        `Planning task: ${task}`,
      ].join("\n");

      await ctx.waitForIdle();
      pi.sendUserMessage(`Use the codex_agent_readonly tool for this task:\n\n${planPrompt}`);
    },
  });
}
