/**
 * Gemini Zellij Extension
 *
 * Adds a `/gemini <prompt>` slash command that:
 * - opens Gemini CLI in a new Zellij pane to the right of the current pane
 * - seeds Gemini with the provided prompt in interactive mode
 * - lets the user watch and interact with Gemini in that pane
 * - captures the pane scrollback after Gemini exits
 * - sends the captured result back into Pi when Gemini exits
 *
 * Optional environment variables:
 * - PI_GEMINI_MODEL: passed to `gemini --model ...`
 *
 * Usage:
 *   /gemini Investigate why the tests are flaky
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const COMMAND_NAME = "gemini";
const PANE_NAME = "gemini";
const TAB_NAME = "gemini";
const MAX_TRANSCRIPT_CHARS = 16_000;
const POLL_INTERVAL_MS = 1000;
const RUN_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const EXTENSION_VERSION = "2026-04-03h";

function stripAnsi(text: string): string {
	return text.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape stripping
		/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
		"",
	);
}

function stripBackspaces(text: string): string {
	let result = text;
	while (result.includes("\b")) {
		result = result.replace(/[^\n]\b/g, "").replace(/\b/g, "");
	}
	return result;
}

export function cleanTranscript(text: string): string {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const withoutAnsi = stripAnsi(normalized);
	const withoutBackspaces = stripBackspaces(withoutAnsi);

	return withoutBackspaces.replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function truncateTranscript(text: string, maxChars = MAX_TRANSCRIPT_CHARS): string {
	if (text.length <= maxChars) return text;

	const note = `[Earlier Gemini transcript omitted. Showing the final ${maxChars.toLocaleString()} characters.]\n\n`;
	const tailBudget = Math.max(0, maxChars - note.length);
	return note + text.slice(-tailBudget).trimStart();
}

function buildRunnerScript(): string {
	return `#!/usr/bin/env bash
set -uo pipefail

if [[ $# -ne 3 ]]; then
  printf 'usage: %s <prompt-file> <done-file> <exit-code-file>\n' "$0" >&2
  exit 2
fi

prompt_file="$1"
done_file="$2"
exit_code_file="$3"

finish() {
  local exit_code="$1"
  mkdir -p "$(dirname "$done_file")"
  printf '%s\n' "$exit_code" > "$exit_code_file"
  touch "$done_file"

  if [[ "\${PI_GEMINI_KEEP_PANE_OPEN:-1}" == "1" ]]; then
    printf '\n[pi/gemini] Gemini exited with code %s. Press Ctrl-D to close this pane.\n' "$exit_code"
    exec "\${SHELL:-/bin/bash}" -i
  fi

  exit "$exit_code"
}

if ! command -v gemini >/dev/null 2>&1; then
  printf 'gemini CLI not found in PATH\n' >&2
  finish 127
fi

prompt="$(cat "$prompt_file")"
args=(--yolo --prompt-interactive "$prompt")

if [[ -n "\${PI_GEMINI_MODEL:-}" ]]; then
  args=(--model "\${PI_GEMINI_MODEL}" "\${args[@]}")
fi

gemini "\${args[@]}"
finish $?
`;
}

async function createRunFiles(prompt: string): Promise<{
	dir: string;
	promptPath: string;
	runnerPath: string;
	transcriptPath: string;
	donePath: string;
	exitCodePath: string;
}> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-gemini-"));
	const promptPath = path.join(dir, "prompt.txt");
	const runnerPath = path.join(dir, "run-gemini.sh");
	const transcriptPath = path.join(dir, "transcript.txt");
	const donePath = path.join(dir, "done");
	const exitCodePath = path.join(dir, "exit-code.txt");

	await fs.writeFile(promptPath, prompt, { encoding: "utf-8", mode: 0o600 });
	await fs.writeFile(runnerPath, buildRunnerScript(), { encoding: "utf-8", mode: 0o700 });

	return { dir, promptPath, runnerPath, transcriptPath, donePath, exitCodePath };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			await sleep(POLL_INTERVAL_MS);
		}
	}

	return false;
}

function buildReturnMessage(prompt: string, transcript: string, transcriptPath: string, exitCode: number): string {
	const cleanPrompt = prompt.trim();
	const cleanOutput = transcript.trim() || "(no Gemini transcript captured)";
	const status = exitCode === 0 ? "completed successfully" : `exited with code ${exitCode}`;

	return [
		`Gemini sidecar session ${status}. Use the transcript below as auxiliary context for the next response.`,
		"",
		"Original `/gemini` prompt:",
		"```text",
		cleanPrompt,
		"```",
		"",
		`Full transcript saved at: ${transcriptPath}`,
		"",
		"Gemini transcript:",
		"```text",
		cleanOutput,
		"```",
	].join("\n");
}

export default function geminiZellijExtension(pi: ExtensionAPI) {
	pi.registerCommand(COMMAND_NAME, {
		description: "Run Gemini in a new Zellij pane and return its transcript to Pi",
		async handler(args, ctx) {
			const prompt = args.trim();
			const isInsideZellij = Boolean(process.env.ZELLIJ || process.env.ZELLIJ_PANE_ID);
			const sessionName = process.env.ZELLIJ_SESSION_NAME?.trim();

			if (!prompt) {
				ctx.ui.notify("Usage: /gemini <prompt>", "warning");
				return;
			}

			if (!isInsideZellij) {
				ctx.ui.notify("/gemini requires Pi to be running inside a Zellij session", "error");
				return;
			}

			if (!sessionName) {
				ctx.ui.notify("/gemini could not determine the current Zellij session name", "error");
				return;
			}

			const { dir, promptPath, runnerPath, transcriptPath, donePath, exitCodePath } =
				await createRunFiles(prompt);

			ctx.ui.notify(
				`[${COMMAND_NAME} ${EXTENSION_VERSION}] Opening Gemini in a dedicated Zellij tab for session ${sessionName}. Exit Gemini there to send its transcript back to Pi.`,
				"info",
			);

			let paneExitCode = 1;
			let paneId: string | null = null;

			const originTabInfo = await pi.exec("zellij", [
				"--session",
				sessionName,
				"action",
				"current-tab-info",
				"--json",
			]);
			const originTab = JSON.parse(originTabInfo.stdout) as { position?: number };
			const originTabPosition = Number.isInteger(originTab.position) ? originTab.position : null;

			try {
				const tabResult = await pi.exec("zellij", [
					"--session",
					sessionName,
					"action",
					"new-tab",
					"--name",
					TAB_NAME,
					"--cwd",
					process.cwd(),
					"--",
					"bash",
					runnerPath,
					promptPath,
					donePath,
					exitCodePath,
				]);

				const tabIdText = (tabResult.stdout || "").trim();
				if (!/^\d+$/.test(tabIdText)) {
					throw new Error(
						`Could not determine Gemini tab id from zellij output: ${(tabResult.stdout || tabResult.stderr || "(empty)").trim()}`,
					);
				}

				await pi.exec("zellij", [
					"--session",
					sessionName,
					"action",
					"go-to-tab-by-id",
					tabIdText,
				]);

				ctx.ui.notify(
					`[${COMMAND_NAME} ${EXTENSION_VERSION}] Opened Gemini tab #${tabIdText} and switched to it`,
					"info",
				);

				const panesResult = await pi.exec("zellij", ["--session", sessionName, "action", "list-panes", "--json"]);
				const panes = JSON.parse(panesResult.stdout) as Array<{
					id: number;
					is_plugin: boolean;
					tab_id: number;
					pane_command?: string;
				}>;
				const tabId = Number.parseInt(tabIdText, 10);
				const geminiPane = panes.find(
					(p) =>
						!p.is_plugin &&
						p.tab_id === tabId &&
						typeof p.pane_command === "string" &&
						p.pane_command.includes("gemini"),
				);
				if (!geminiPane) {
					throw new Error("Could not locate Gemini pane in the newly created tab");
				}
				paneId = `terminal_${geminiPane.id}`;
				ctx.ui.notify(`[${COMMAND_NAME} ${EXTENSION_VERSION}] Gemini pane is ${paneId}`, "info");

				const completed = await waitForFile(donePath, RUN_TIMEOUT_MS);
				if (!completed) {
					throw new Error("Timed out waiting for Gemini to exit");
				}

				try {
					const exitCode = await fs.readFile(exitCodePath, "utf-8");
					paneExitCode = Number.parseInt(exitCode.trim(), 10);
					if (Number.isNaN(paneExitCode)) paneExitCode = 1;
				} catch {
					paneExitCode = 1;
				}

				const dumpResult = await pi.exec("zellij", [
					"--session",
					sessionName,
					"action",
					"dump-screen",
					"--pane-id",
					paneId,
					"--full",
					"--path",
					transcriptPath,
				]);

				let transcript = "";
				try {
					transcript = cleanTranscript(await fs.readFile(transcriptPath, "utf-8"));
				} catch {
					const stderr = (dumpResult.stderr || "").trim();
					const stdout = (dumpResult.stdout || "").trim();
					transcript = cleanTranscript(stderr || stdout);
				}

				if (originTabPosition !== null) {
					await pi.exec("zellij", [
						"--session",
						sessionName,
						"action",
						"go-to-tab",
						String(originTabPosition),
					]);
					ctx.ui.notify(
						`[${COMMAND_NAME} ${EXTENSION_VERSION}] Returned to original Pi tab #${originTabPosition + 1}`,
						"info",
					);
				}

				const content = buildReturnMessage(
					prompt,
					truncateTranscript(transcript),
					transcriptPath,
					paneExitCode,
				);

				if (ctx.isIdle()) {
					pi.sendMessage({ customType: COMMAND_NAME, content, display: true }, { triggerTurn: true });
					ctx.ui.notify("Gemini transcript sent back to Pi", "info");
				} else {
					pi.sendMessage({ customType: COMMAND_NAME, content, display: true }, { deliverAs: "followUp" });
					ctx.ui.notify("Gemini transcript queued as a follow-up for Pi", "info");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to launch Gemini in Zellij: ${message}`, "error");
				await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
				return;
			}

			await fs.rm(promptPath, { force: true }).catch(() => undefined);
			await fs.rm(runnerPath, { force: true }).catch(() => undefined);
			await fs.rm(donePath, { force: true }).catch(() => undefined);
			await fs.rm(exitCodePath, { force: true }).catch(() => undefined);
			},
		});
}
