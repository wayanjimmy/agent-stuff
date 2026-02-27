import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { GeminiAgentParams } from "./gemini-params.ts";
import { runGeminiAgent } from "./gemini-runner.ts";
import { renderGeminiCall, renderGeminiResult } from "./gemini-ui.ts";

export default function geminiAgentExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "gemini_agent",
    label: "Gemini Agent",
    description:
      "Delegate a coding task to the Gemini CLI agent. The agent runs as a subprocess and can read files, run commands, and edit code. Use for tasks that benefit from a separate agent context.",
    parameters: GeminiAgentParams,

    async execute(_toolCallId, params, signal, onUpdate) {
      const p = params as Record<string, any>;

      const task = typeof p.task === "string" ? p.task.trim() : "";
      if (!task) {
        return {
          content: [
            { type: "text", text: "Invalid parameters: `task` must be a non-empty string." },
          ],
          isError: true,
        };
      }

      const result = await runGeminiAgent({
        task,
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        approvalMode: typeof p.approvalMode === "string" ? p.approvalMode : undefined,
        model: typeof p.model === "string" ? p.model : undefined,
        includeDirectories: Array.isArray(p.includeDirectories)
          ? p.includeDirectories
          : undefined,
        continueSession: p.continueSession === true,
        resume: typeof p.resume === "string" ? p.resume : undefined,
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
    },

    renderCall(args, theme) {
      return renderGeminiCall(args, theme);
    },

    renderResult(result, opts, theme) {
      return renderGeminiResult(result, opts, theme);
    },
  });

  pi.registerCommand("gemini", {
    description: "Delegate a task to the Gemini CLI agent. Usage: /gemini <task>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      let task = args.trim();

      if (!task && ctx.hasUI) {
        task = ctx.ui.getEditorText().trim();
        if (task) ctx.ui.setEditorText("");
      }

      if (!task) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /gemini <task>", "warning");
        }
        return;
      }

      await ctx.waitForIdle();
      pi.sendUserMessage(
        `Use the gemini_agent tool with approvalMode "yolo" for this task: ${task}`,
      );
    },
  });

  // /gemini-researcher — deep research agent
  pi.registerCommand("gemini-researcher", {
    description: "Use Gemini as a research specialist for deep analysis and web search. Usage: /gemini-researcher <task>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      let task = args.trim();

      if (!task && ctx.hasUI) {
        task = ctx.ui.getEditorText().trim();
        if (task) ctx.ui.setEditorText("");
      }

      if (!task) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /gemini-researcher <task>", "warning");
        }
        return;
      }

      const researchPrompt = [
        "You are a research specialist. Delegate deep research tasks, web searching, and synthesis to the gemini_agent tool.",
        "It has full autonomous power to conduct research and provide a detailed report.",
        "",
        `Research task: ${task}`,
      ].join("\n");

      await ctx.waitForIdle();
      pi.sendUserMessage(
        `Use the gemini_agent tool with approvalMode "yolo" and model "gemini-2.5-flash" for this task:\n\n${researchPrompt}`,
      );
    },
  });

  // /gemini-reviewer — code review agent
  pi.registerCommand("gemini-reviewer", {
    description: "Use Gemini as a code reviewer (read-only). Usage: /gemini-reviewer <task>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      let task = args.trim();

      if (!task && ctx.hasUI) {
        task = ctx.ui.getEditorText().trim();
        if (task) ctx.ui.setEditorText("");
      }

      if (!task) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /gemini-reviewer <task>", "warning");
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
      pi.sendUserMessage(
        `Use the gemini_agent tool with approvalMode "plan" and model "gemini-3.1-pro-preview" for this task:\n\n${reviewPrompt}`,
      );
    },
  });
}
