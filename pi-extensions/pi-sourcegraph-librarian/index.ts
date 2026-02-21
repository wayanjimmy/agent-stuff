import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import {
	DefaultResourceLoader,
	SessionManager,
	createAgentSession,
	createBashTool,
	createReadTool,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

import {
	DEFAULT_MAX_SEARCH_RESULTS,
	DEFAULT_MAX_TURNS,
	LibrarianParams,
	MAX_TOOL_CALLS_TO_KEEP,
	asStringArray,
	bumpDefaultEventTargetMaxListeners,
	clampNumber,
	computeOverallStatus,
	formatToolCall,
	getLastAssistantText,
	parseBackends,
	renderCombinedMarkdown,
	shorten,
	type LibrarianDetails,
	type LibrarianRunDetails,
} from "./librarian-core.ts";
import { buildLibrarianSystemPrompt, buildLibrarianUserPrompt } from "./librarian-prompts.ts";

function createTurnBudgetExtension(maxTurns: number): ExtensionFactory {
	return (pi) => {
		let turnIndex = 0;

		pi.on("turn_start", async (event) => {
			turnIndex = event.turnIndex;
		});

		pi.on("tool_call", async () => {
			if (turnIndex < maxTurns - 1) return undefined;

			const humanTurn = Math.min(turnIndex + 1, maxTurns);
			return {
				block: true,
				reason: `Tool use is disabled on the final turn (turn ${humanTurn}/${maxTurns}). Provide your final answer now without calling tools.`,
			};
		});

		pi.on("tool_result", async (event) => {
			const remainingAfter = Math.max(0, maxTurns - (turnIndex + 1));
			const humanTurn = Math.min(turnIndex + 1, maxTurns);
			const budgetLine = `[turn budget] turn ${humanTurn}/${maxTurns}; remaining after this turn: ${remainingAfter}`;

			return {
				content: [...(event.content ?? []), { type: "text", text: `\n\n${budgetLine}` }],
			};
		});
	};
}

export default function sourcegraphLibrarianExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "librarian",
		label: "Librarian",
		description:
			"Cross-repo code researcher using Sourcegraph (default) and/or Zread. Use when the answer likely lives in public codebases, exact locations are unknown, or you need to find implementations, patterns, or usage examples across open-source repositories. Sourcegraph for broad code search; Zread for semantic doc search and file reading. Returns evidence-first findings with verifiable links.",
		parameters: LibrarianParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
			const restoreMaxListeners = bumpDefaultEventTargetMaxListeners();
			let abortListenerAdded = false;
			let onAbort: (() => void) | undefined;
			try {
				const query = typeof (params as any).query === "string" ? ((params as any).query as string).trim() : "";
				if (!query) {
					return {
						content: [{ type: "text", text: "Invalid parameters: expected `query` to be a non-empty string." }],
						details: { status: "error", runs: [] } satisfies LibrarianDetails,
						isError: true,
					};
				}

				const repos = asStringArray((params as any).repos);
				const backends = parseBackends((params as any).backends);
				const maxSearchResults = clampNumber(
					(params as any).maxSearchResults,
					1,
					20,
					DEFAULT_MAX_SEARCH_RESULTS,
				);
				const maxTurns = DEFAULT_MAX_TURNS;

				const workspaceBase = "/tmp/pi-sourcegraph-librarian";
				await fs.mkdir(workspaceBase, { recursive: true });
				const workspace = await fs.mkdtemp(path.join(workspaceBase, "run-"));

				const vendorDir = path.join(import.meta.dirname!, "vendor");

				const runs: LibrarianRunDetails[] = [
					{
						status: "running",
						query,
						turns: 0,
						toolCalls: [],
						startedAt: Date.now(),
					},
				];

				const modelRegistry = ctx.modelRegistry;
				const subModel = ctx.model;

				if (!subModel) {
					const error = "No model selected. Configure credentials (e.g. /login or auth.json) and try again.";
					runs[0].status = "error";
					runs[0].error = error;
					runs[0].summaryText = error;
					runs[0].endedAt = Date.now();
					return {
						content: [{ type: "text", text: error }],
						details: { status: "error", workspace, backends, runs } satisfies LibrarianDetails,
						isError: true,
					};
				}

				const subagentThinkingLevel = "off";
				const subagentSelection = {
					authMode: "inherited",
					authSource: "parent",
					reason: `using parent model ${subModel.id}`,
				};

				let lastUpdate = 0;
				const emitAll = (force = false) => {
					const now = Date.now();
					if (!force && now - lastUpdate < 120) return;
					lastUpdate = now;

					const status = computeOverallStatus(runs);
					const text = renderCombinedMarkdown(runs);

					onUpdate?.({
						content: [{ type: "text", text }],
						details: {
							status,
							workspace,
							backends,
							subagentProvider: subModel.provider,
							subagentModelId: subModel.id,
							subagentSelection,
							runs,
						} satisfies LibrarianDetails,
					});
				};

				emitAll(true);

				const systemPrompt = buildLibrarianSystemPrompt(maxTurns, workspace, vendorDir, maxSearchResults, backends);

				let toolAborted = false;
				const activeSessions = new Set<{ abort: () => Promise<void> }>();

				const markAllAborted = () => {
					for (const run of runs) {
						if (run.status !== "running") continue;
						run.status = "aborted";
						run.summaryText = run.summaryText ?? "Aborted";
						run.endedAt = Date.now();
					}
				};

				const abortAll = async () => {
					if (toolAborted) return;
					toolAborted = true;
					markAllAborted();
					emitAll(true);
					await Promise.allSettled([...activeSessions].map((session) => session.abort()));
				};

				onAbort = () => void abortAll();

				if (signal?.aborted) {
					await abortAll();
					const status = computeOverallStatus(runs);
					const text = renderCombinedMarkdown(runs);
					return {
						content: [{ type: "text", text }],
						details: {
							status,
							workspace,
							backends,
							runs,
							subagentProvider: subModel.provider,
							subagentModelId: subModel.id,
							subagentSelection,
						} satisfies LibrarianDetails,
						isError: status === "error",
					};
				}

				if (signal) {
					signal.addEventListener("abort", onAbort);
					abortListenerAdded = true;
				}

				const wasAborted = () => toolAborted || signal?.aborted;
				const run = runs[0];

				let session: any;
				let unsubscribe: (() => void) | undefined;

				try {
					const resourceLoader = new DefaultResourceLoader({
						noExtensions: true,
						noSkills: true,
						noPromptTemplates: true,
						noThemes: true,
						extensionFactories: [createTurnBudgetExtension(maxTurns)],
						systemPromptOverride: () => systemPrompt,
						skillsOverride: () => ({ skills: [], diagnostics: [] }),
					});
					await resourceLoader.reload();

					run.status = "running";
					run.turns = 0;
					run.toolCalls = [];
					run.startedAt = Date.now();
					run.endedAt = undefined;
					run.error = undefined;
					run.summaryText = undefined;

					const { session: createdSession } = await createAgentSession({
						cwd: workspace,
						modelRegistry,
						resourceLoader,
						sessionManager: SessionManager.inMemory(workspace),
						model: subModel,
						thinkingLevel: subagentThinkingLevel,
						tools: [createReadTool(workspace), createBashTool(workspace)],
					});

					session = createdSession;
					activeSessions.add(session as any);

					unsubscribe = session.subscribe((event: any) => {
						switch (event.type) {
							case "turn_end": {
								run.turns += 1;
								emitAll();
								break;
							}
							case "tool_execution_start": {
								run.toolCalls.push({
									id: event.toolCallId,
									name: event.toolName,
									args: event.args,
									startedAt: Date.now(),
								});
								if (run.toolCalls.length > MAX_TOOL_CALLS_TO_KEEP) {
									run.toolCalls.splice(0, run.toolCalls.length - MAX_TOOL_CALLS_TO_KEEP);
								}
								emitAll(true);
								break;
							}
							case "tool_execution_end": {
								const call = run.toolCalls.find((c) => c.id === event.toolCallId);
								if (call) {
									call.endedAt = Date.now();
									call.isError = event.isError;
								}
								emitAll(true);
								break;
							}
						}
					});

					await session.prompt(buildLibrarianUserPrompt(query, repos, maxSearchResults), {
						expandPromptTemplates: false,
					});
					run.summaryText = getLastAssistantText(session.state.messages as any[]).trim();
					if (!run.summaryText) run.summaryText = wasAborted() ? "Aborted" : "(no output)";
					run.status = wasAborted() ? "aborted" : "done";
					run.endedAt = Date.now();
					emitAll(true);
				} catch (error) {
					const message = wasAborted() ? "Aborted" : error instanceof Error ? error.message : String(error);
					run.status = wasAborted() ? "aborted" : "error";
					run.error = wasAborted() ? undefined : message;
					run.summaryText = message;
					run.endedAt = Date.now();
					emitAll(true);
				} finally {
					if (session) activeSessions.delete(session as any);
					unsubscribe?.();
					session?.dispose();

					// Clean up workspace directory
					try {
						await fs.rm(workspace, { recursive: true, force: true });
					} catch (e) {
						// Ignore cleanup errors
					}
				}

				const status = computeOverallStatus(runs);
				const text = renderCombinedMarkdown(runs);

				return {
					content: [{ type: "text", text }],
					details: {
						status,
						workspace,
						backends,
						runs,
						subagentProvider: subModel.provider,
						subagentModelId: subModel.id,
						subagentSelection,
					} satisfies LibrarianDetails,
					isError: status === "error",
				};
			} finally {
				if (signal && abortListenerAdded && onAbort) signal.removeEventListener("abort", onAbort);
				restoreMaxListeners();
			}
		},

		renderCall(args, theme) {
			const query = typeof (args as any)?.query === "string" ? ((args as any).query as string).trim() : "";
			const repos = Array.isArray((args as any)?.repos) ? (args as any).repos.length : 0;
			const activeBackends = parseBackends((args as any)?.backends);
			const preview = shorten(query.replace(/\s+/g, " ").trim(), 70);

			const title = theme.fg("toolTitle", theme.bold("librarian"));
			const scope = theme.fg("muted", `repos:${repos} (${activeBackends.join("+")})`);
			const text = title + (preview ? `\n${scope} · ${preview}` : `\n${scope}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as LibrarianDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const status = isPartial ? "running" : details.status;
			const icon =
				status === "done"
					? theme.fg("success", "✓")
					: status === "error"
						? theme.fg("error", "✗")
						: status === "aborted"
							? theme.fg("warning", "◼")
							: theme.fg("warning", "⏳");

			const run = details.runs[0];
			const totalToolCalls = run?.toolCalls.length ?? 0;
			const totalTurns = run?.turns ?? 0;

			const backendLabel = details.backends?.join("+") ?? "zread";
			const header =
				icon +
				" " +
				theme.fg("toolTitle", theme.bold("librarian ")) +
				theme.fg(
					"dim",
					`${details.subagentProvider ?? "?"}/${details.subagentModelId ?? "?"} • ${backendLabel} • ${totalTurns} turns • ${totalToolCalls} tool call${totalToolCalls === 1 ? "" : "s"}`,
				);

			const workspaceLine = details.workspace
				? `${theme.fg("muted", "workspace: ")}${theme.fg("toolOutput", details.workspace)}`
				: theme.fg("muted", "workspace: (none)");

			const selectionReasonLine = details.subagentSelection
				? `${theme.fg("muted", "selection: ")}${theme.fg("toolOutput", details.subagentSelection.reason)}`
				: undefined;

			let toolsText = "";
			if (run && run.toolCalls.length > 0) {
				const calls = expanded ? run.toolCalls : run.toolCalls.slice(-6);
				const lines: string[] = [theme.fg("muted", "Tools:")];
				for (const call of calls) {
					const callIcon = call.isError ? theme.fg("error", "✗") : theme.fg("dim", "→");
					lines.push(`${callIcon} ${theme.fg("toolOutput", formatToolCall(call))}`);
				}
				if (!expanded && run.toolCalls.length > 6) lines.push(theme.fg("muted", "(Ctrl+O to expand)"));
				toolsText = lines.join("\n");
			}

			if (status === "running") {
				let text = `${header}\n${workspaceLine}`;
				if (expanded && selectionReasonLine) text += `\n${selectionReasonLine}`;
				if (toolsText) text += `\n\n${toolsText}`;
				text += `\n\n${theme.fg("muted", `Searching ${backendLabel}…`)}`;
				return new Text(text, 0, 0);
			}

			const mdTheme = getMarkdownTheme();
			const combined =
				(result.content[0]?.type === "text" ? result.content[0].text : renderCombinedMarkdown(details.runs)).trim() ||
				"(no output)";

			if (!expanded) {
				const previewLines = combined.split("\n").slice(0, 18).join("\n");
				let text = `${header}\n${workspaceLine}\n\n${theme.fg("toolOutput", previewLines)}`;
				if (combined.split("\n").length > 18) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				if (toolsText) text += `\n\n${toolsText}`;
				return new Text(text, 0, 0);
			}

			const container = new Container();
			container.addChild(new Text(header, 0, 0));
			container.addChild(new Text(workspaceLine, 0, 0));
			if (selectionReasonLine) container.addChild(new Text(selectionReasonLine, 0, 0));
			if (toolsText) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(toolsText, 0, 0));
			}
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(combined, 0, 0, mdTheme));
			return container;
		},
	});
}
