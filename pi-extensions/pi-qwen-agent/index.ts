import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

import { QwenAgentParams } from "./qwen-params.ts";
import { runQwenAgent, type QwenRunState } from "./qwen-runner.ts";
import { renderQwenCall, renderQwenResult } from "./qwen-ui.ts";

export default function qwenAgentExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "qwen_agent",
		label: "Qwen Agent",
		description:
			"Delegate a coding task to the Qwen Code CLI agent. The agent runs as a subprocess and can read files, run commands, and edit code. Use for tasks that benefit from a separate agent context.",
		parameters: QwenAgentParams,

		async execute(_toolCallId, params, signal, onUpdate) {
			const p = params as Record<string, any>;

			const task = typeof p.task === "string" ? p.task.trim() : "";
			if (!task) {
				return {
					content: [{ type: "text", text: "Invalid parameters: `task` must be a non-empty string." }],
					isError: true,
				};
			}

			const state: { current: QwenRunState | null } = { current: null };

			const result = await runQwenAgent({
				task,
				cwd: typeof p.cwd === "string" ? p.cwd : undefined,
				approvalMode: typeof p.approval_mode === "string" ? p.approval_mode : undefined,
				model: typeof p.model === "string" ? p.model : undefined,
				includeDirectories: Array.isArray(p.include_directories) ? p.include_directories : undefined,
				continueSession: p.continue === true,
				resume: typeof p.resume === "string" ? p.resume : undefined,
				signal: signal ?? undefined,
				onUpdate: (s) => {
					state.current = s;
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
			return renderQwenCall(args, theme);
		},

		renderResult(result, opts, theme) {
			return renderQwenResult(result, opts, theme);
		},
	});

	pi.registerCommand("qwen", {
		description: "Delegate a task to the Qwen Code CLI agent. Usage: /qwen <task>",
		async handler(args: string, ctx: ExtensionCommandContext) {
			let task = args.trim();

			if (!task && ctx.hasUI) {
				task = ctx.ui.getEditorText().trim();
				if (task) ctx.ui.setEditorText("");
			}

			if (!task) {
				if (ctx.hasUI) {
					ctx.ui.notify("Usage: /qwen <task>", "warning");
				}
				return;
			}

			await ctx.waitForIdle();
			pi.sendUserMessage(`Use the qwen_agent tool for this task: ${task}`);
		},
	});
}
