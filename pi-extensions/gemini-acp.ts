/**
 * Gemini ACP Extension
 *
 * Slash commands:
 *   /gemini <prompt>                    - Run prompt in current/resumed session
 *   /gemini new <prompt>                - Start a new session with prompt
 *   /gemini resume <sessionId> [prompt] - Resume a session, optionally with prompt
 *   /gemini cmd <name> [args...]        - Run a custom .toml command
 *   /gemini stop                        - Cancel current run
 *   /gemini status                      - Show process/session status
 *   /gemini sessions                    - List known sessions
 *
 * Architecture:
 * - Spawns `gemini --acp` as a background subprocess
 * - Communicates via JSON-RPC 2.0 over NDJSON (stdio)
 * - Streams progress to Pi UI (status bar + widget)
 * - Persists session state via pi.appendEntry()
 * - Auto-approves all permission requests (YOLO mode)
 *
 * Custom commands:
 * - Resolves .toml files from .gemini/commands/ or ~/.gemini/commands/
 * - Supports namespacing: "git:commit" -> commands/git/commit.toml
 * - Expands {{args}} placeholder or appends args after prompt
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, isKeyRelease, matchesKey } from "@mariozechner/pi-tui";

const EXT_STATUS_KEY = "gemini-acp";
const EXT_WIDGET_KEY = "gemini-acp";
const STATE_ENTRY_TYPE = "gemini-acp-state";
const DEFAULT_TIMEOUT_MS = 120_000;
const PROMPT_TIMEOUT_MS = 15 * 60_000;

type JsonRpcRequest = {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: unknown;
};

type JsonRpcNotification = {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
};

type JsonRpcIncomingRequest = {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: any;
};

type GeminiState = {
	currentSessionId?: string;
	sessions: Record<string, { lastUsedAt: number; cwd: string; model?: string }>;
};

type LivePhase =
	| "starting"
	| "initializing"
	| "authenticating"
	| "loading-session"
	| "creating-session"
	| "sending-prompt"
	| "waiting"
	| "streaming"
	| "cancelling"
	| "completed"
	| "error";

type LiveRun = {
	sessionId: string;
	startedAt: number;
	prompt: string;
	answer: string;
	answerStarted: boolean;
	thought: string;
	thoughtStarted: boolean;
	events: string[];
	running: boolean;
	phase: LivePhase;
	currentAction: string;
	model?: string;
	stopReason?: string;
	error?: string;
	lastEventMessage?: string;
};

type PermissionOption = { optionId?: string; id?: string; name?: string; title?: string; label?: string };
type GeminiLaunchSpec = { command: string; args: string[] };
type ClientActivity = { phase: LivePhase; message: string };

class AcpClient {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private nextId = 1;
	private ready = false;
	private initialized = false;
	private lineBuffer = "";
	private stderrBuffer = "";
	private loadedSessions = new Set<string>();
	private pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (err: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private notificationHandlers = new Set<(method: string, params: any) => void>();
	private activityHandlers = new Set<(activity: ClientActivity) => void>();

	constructor(private readonly pi: ExtensionAPI) { }

	onNotification(handler: (method: string, params: any) => void): () => void {
		this.notificationHandlers.add(handler);
		return () => this.notificationHandlers.delete(handler);
	}

	onActivity(handler: (activity: ClientActivity) => void): () => void {
		this.activityHandlers.add(handler);
		return () => this.activityHandlers.delete(handler);
	}

	isRunning(): boolean {
		return !!this.proc && !this.proc.killed;
	}

	async ensureReady(cwd: string): Promise<void> {
		if (!this.proc || this.proc.killed) {
			this.spawnProcess(cwd);
		}
		if (this.ready) return;

		this.emitActivity("initializing", "Initializing ACP handshake");
		await this.initialize();
		this.emitActivity("authenticating", "Authenticating Gemini session");
		await this.authenticateIfConfigured();
		this.ready = true;
		this.emitActivity("waiting", "Gemini ACP client is ready");
	}

	async ensureSession(cwd: string, sessionId?: string, options?: { explicitResume?: boolean }): Promise<string> {
		await this.ensureReady(cwd);

		if (sessionId) {
			if (!this.loadedSessions.has(sessionId)) {
				try {
					this.emitActivity("loading-session", `Loading Gemini session ${sessionId}`);
					await this.request("session/load", { sessionId, cwd, mcpServers: [] }, DEFAULT_TIMEOUT_MS);
					this.loadedSessions.add(sessionId);
					this.emitActivity("waiting", `Loaded Gemini session ${sessionId}`);
					return sessionId;
				} catch (err) {
					if (options?.explicitResume) {
						throw new Error(
							`Failed to resume session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
					this.emitActivity("creating-session", `Could not load ${sessionId}; creating a new Gemini session`);
					// Automatic resume path: fall through to creating a new session.
				}
			} else {
				this.emitActivity("waiting", `Using already loaded Gemini session ${sessionId}`);
				return sessionId;
			}
		}

		this.emitActivity("creating-session", "Creating a new Gemini session");
		const created = (await this.request("session/new", { cwd, mcpServers: [] }, DEFAULT_TIMEOUT_MS)) as {
			sessionId?: string;
		};
		if (!created?.sessionId) {
			throw new Error("ACP newSession did not return a sessionId");
		}
		this.loadedSessions.add(created.sessionId);
		this.emitActivity("waiting", `Created Gemini session ${created.sessionId}`);
		return created.sessionId;
	}

	async prompt(sessionId: string, text: string): Promise<{ stopReason?: string; _meta?: any }> {
		this.emitActivity("sending-prompt", `Sending prompt to Gemini session ${sessionId}`);
		const result = (await this.request(
			"session/prompt",
			{
				sessionId,
				prompt: [{ type: "text", text }],
			},
			PROMPT_TIMEOUT_MS,
		)) as { stopReason?: string; _meta?: any };
		this.emitActivity("completed", `Prompt finished for session ${sessionId}`);
		return result ?? {};
	}

	async cancel(sessionId: string): Promise<void> {
		this.emitActivity("cancelling", `Cancelling Gemini session ${sessionId}`);
		await this.notify("session/cancel", { sessionId });
	}

	stop(): void {
		if (this.proc && !this.proc.killed) {
			this.terminateProcess(this.proc);
		}
		this.teardown(new Error("Gemini ACP process stopped"));
	}

	getStderrTail(): string {
		return this.stderrBuffer.slice(-1500);
	}

	private emitActivity(phase: LivePhase, message: string): void {
		for (const handler of this.activityHandlers) {
			handler({ phase, message });
		}
	}

	private spawnProcess(cwd: string): void {
		const bin = process.env.GEMINI_BIN || "gemini";
		const launch = getGeminiLaunchSpec(bin);
		this.emitActivity("starting", `Launching ${launch.command} ${launch.args.join(" ")}`);

		const proc = spawn(launch.command, launch.args, {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
			windowsHide: true,
		});

		this.proc = proc;
		this.ready = false;
		this.initialized = false;
		this.lineBuffer = "";
		this.stderrBuffer = "";
		this.loadedSessions.clear();

		proc.stdout.setEncoding("utf8");
		proc.stderr.setEncoding("utf8");

		proc.stdout.on("data", (chunk: string) => {
			this.lineBuffer += chunk;
			while (true) {
				const idx = this.lineBuffer.indexOf("\n");
				if (idx < 0) break;
				const line = this.lineBuffer.slice(0, idx).trim();
				this.lineBuffer = this.lineBuffer.slice(idx + 1);
				if (!line) continue;
				this.handleLine(line);
			}
		});

		proc.stderr.on("data", (chunk: string) => {
			this.stderrBuffer += chunk;
			if (this.stderrBuffer.length > 6000) {
				this.stderrBuffer = this.stderrBuffer.slice(-6000);
			}
		});

		proc.on("exit", (code, signal) => {
			this.teardown(new Error(`Gemini ACP exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
		});

		proc.on("error", (err) => {
			this.teardown(new Error(`Failed to spawn gemini ACP: ${err.message}`));
		});
	}

	private terminateProcess(proc: ChildProcessWithoutNullStreams): void {
		if (process.platform !== "win32") {
			proc.kill("SIGTERM");
			return;
		}

		if (typeof proc.pid !== "number") {
			proc.kill();
			return;
		}

		try {
			const killer = spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], {
				stdio: "ignore",
				windowsHide: true,
			});
			killer.on("error", () => proc.kill());
		} catch {
			proc.kill();
		}
	}

	private handleLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}

		if ("id" in msg && ("result" in msg || "error" in msg)) {
			const pending = this.pending.get(msg.id);
			if (!pending) return;
			this.pending.delete(msg.id);
			clearTimeout(pending.timer);

			if (msg.error) {
				const details =
					msg.error.data == null
						? ""
						: ` | ${typeof msg.error.data === "string" ? msg.error.data : JSON.stringify(msg.error.data)}`;
				pending.reject(new Error(`ACP ${msg.error.code}: ${msg.error.message}${details}`));
			} else {
				pending.resolve(msg.result);
			}
			return;
		}

		if ("id" in msg && "method" in msg && !("result" in msg) && !("error" in msg)) {
			this.handleIncomingRequest(msg as JsonRpcIncomingRequest);
			return;
		}

		if ("method" in msg) {
			for (const h of this.notificationHandlers) {
				h(msg.method, (msg as JsonRpcNotification).params);
			}
		}
	}

	private handleIncomingRequest(request: JsonRpcIncomingRequest): void {
		for (const h of this.notificationHandlers) {
			h(request.method, request.params);
		}

		if (request.method === "requestPermission") {
			const options = (request.params?.options || request.params?.permissionOptions || []) as PermissionOption[];
			const selectedOptionId = pickYoloPermissionOption(options);

			if (!selectedOptionId) {
				this.writeResponse(request.id, { outcome: "cancelled" });
				return;
			}

			const result = { outcome: "selected", optionId: selectedOptionId };
			this.writeResponse(request.id, result);
			return;
		}

		// Default ACK for unknown client-bound request methods.
		this.writeResponse(request.id, {});
	}

	private writeResponse(id: number, result: unknown): void {
		if (!this.proc || this.proc.killed || !this.proc.stdin.writable) return;
		const response = { jsonrpc: "2.0", id, result };
		this.proc.stdin.write(JSON.stringify(response) + "\n");
	}

	private async initialize(): Promise<void> {
		if (this.initialized) return;

		const initParams = {
			protocolVersion: 1,
			clientInfo: { name: "pi-gemini-acp", version: "0.1.0" },
			capabilities: {
				fs: { readTextFile: false, writeTextFile: false },
			},
		};

		await this.request("initialize", initParams, DEFAULT_TIMEOUT_MS);
		this.initialized = true;
	}

	private async authenticateIfConfigured(): Promise<void> {
		const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

		try {
			if (apiKey) {
				await this.request(
					"authenticate",
					{ methodId: "gemini-api-key", _meta: { "api-key": apiKey } },
					DEFAULT_TIMEOUT_MS,
				);
				return;
			}

			// Prefer existing Gemini CLI OAuth session when no API key is provided.
			await this.request("authenticate", { methodId: "oauth-personal" }, DEFAULT_TIMEOUT_MS);
		} catch {
			// Non-fatal: session/new will surface a clearer auth error if this fails.
		}
	}

	private request(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
		if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
			throw new Error("Gemini ACP process is not available");
		}

		const id = this.nextId++;
		const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`ACP request timed out: ${method}`));
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timer });

			try {
				this.proc!.stdin.write(JSON.stringify(request) + "\n");
			} catch (err) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(err instanceof Error ? err : new Error("Failed to write ACP request"));
			}
		});
	}

	private async notify(method: string, params?: unknown): Promise<void> {
		if (!this.proc || this.proc.killed || !this.proc.stdin.writable) return;
		const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
		this.proc.stdin.write(JSON.stringify(notification) + "\n");
	}

	private teardown(error: Error): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			this.pending.delete(id);
		}
		this.ready = false;
		this.initialized = false;
		this.proc = null;
		this.loadedSessions.clear();
	}
}

function restoreState(ctx: any): GeminiState {
	const state: GeminiState = { sessions: {} };
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		const data = entry.data as GeminiState | undefined;
		if (data && typeof data === "object") {
			state.currentSessionId = data.currentSessionId;
			state.sessions = data.sessions || {};
		}
	}
	return state;
}

function extractText(value: any): string {
	if (!value) return "";
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("");
	if (typeof value === "object") {
		if (typeof value.text === "string") return value.text;
		if (typeof value.content === "string") return value.content;
		if (typeof value.delta === "string") return value.delta;
		if (typeof value.chunk === "string") return value.chunk;
		if (value.delta && typeof value.delta === "object") return extractText(value.delta);
		if (value.content && Array.isArray(value.content)) return extractText(value.content);
	}
	return "";
}

function trimLines(lines: string[], max: number): string[] {
	if (lines.length <= max) return lines;
	return lines.slice(lines.length - max);
}

function compactWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function clipEnd(value: string, max: number): string {
	if (value.length <= max) return value;
	return `…${value.slice(value.length - max + 1)}`;
}

function wrapText(value: string, maxWidth: number): string[] {
	const text = compactWhitespace(value);
	if (!text) return [];

	const words = text.split(" ");
	const lines: string[] = [];
	let current = "";

	const pushChunkedWord = (word: string) => {
		if (word.length <= maxWidth) {
			current = word;
			return;
		}

		if (current) {
			lines.push(current);
			current = "";
		}

		for (let idx = 0; idx < word.length; idx += maxWidth) {
			const chunk = word.slice(idx, idx + maxWidth);
			if (idx + maxWidth >= word.length) {
				current = chunk;
			} else {
				lines.push(chunk);
			}
		}
	};

	for (const word of words) {
		if (!word) continue;
		if (!current) {
			pushChunkedWord(word);
			continue;
		}

		const next = `${current} ${word}`;
		if (next.length <= maxWidth) {
			current = next;
			continue;
		}

		lines.push(current);
		current = "";
		pushChunkedWord(word);
	}

	if (current) lines.push(current);
	return lines;
}

function formatLabeledBlock(label: string, value: string, width: number, maxLines: number): string[] {
	const normalized = compactWhitespace(value);
	if (!normalized) return [];

	const available = Math.max(16, width - label.length - 2);
	const wrapped = wrapText(normalized, available);
	const visible = wrapped.slice(0, maxLines);
	if (wrapped.length > maxLines && visible.length > 0) {
		visible[visible.length - 1] = clipEnd(visible[visible.length - 1], Math.max(4, available - 1)) + "…";
	}

	return visible.map((line, idx) => `${idx === 0 ? `${label}:` : "  "} ${line}`);
}

function formatSection(label: string, value: string, width: number, maxLines: number): string[] {
	const normalized = compactWhitespace(value);
	if (!normalized) return [];

	const wrapped = wrapText(normalized, Math.max(16, width));
	const visible = wrapped.slice(0, maxLines);
	if (wrapped.length > maxLines && visible.length > 0) {
		visible[visible.length - 1] = clipEnd(visible[visible.length - 1], Math.max(4, width - 1)) + "…";
	}

	return [`${label}:`, ...visible];
}

// ---------------------------------------------------------------------------
// Gemini custom command (.toml) resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Gemini custom command by name.
 * Looks in project `.gemini/commands/` first, then user `~/.gemini/commands/`.
 * Namespacing: "git:commit" -> `commands/git/commit.toml`.
 * Returns the expanded prompt text with `{{args}}` replaced, or undefined.
 */
function resolveGeminiCommand(name: string, args: string, cwd: string): string | undefined {
	const candidates = buildCommandPaths(name, cwd);
	for (const filePath of candidates) {
		if (!existsSync(filePath)) continue;
		try {
			const raw = readFileSync(filePath, "utf8");
			const prompt = extractTomlPrompt(raw);
			if (!prompt) continue;
			return expandGeminiCommandPrompt(prompt, args);
		} catch {
			// Skip unreadable files.
		}
	}
	return undefined;
}

function buildCommandPaths(name: string, cwd: string): string[] {
	if (!/^[a-zA-Z0-9_:-]+$/.test(name)) return []; // Prevent path traversal
	// Convert colon-namespace to path segments: "git:commit" -> ["git", "commit"]
	const segments = name.split(":");
	const tomlFile = segments.join("/") + ".toml";

	// Project-level takes precedence.
	const projectDir = join(cwd, ".gemini", "commands");
	const userDir = join(homedir(), ".gemini", "commands");

	return [join(projectDir, tomlFile), join(userDir, tomlFile)];
}

/**
 * Minimal TOML `prompt` field extraction.
 * Handles single-line (`prompt = "..."`) and multi-line (`prompt = """..."""`) values.
 */
function extractTomlPrompt(tomlSource: string): string | undefined {
	// Multi-line triple-quoted prompt
	const mlMatch = tomlSource.match(/^\s*prompt\s*=\s*"""([\s\S]*?)"""/m);
	if (mlMatch) return mlMatch[1];

	// Single-line quoted prompt
	const slMatch = tomlSource.match(/^\s*prompt\s*=\s*["']((?:[^"\\]|\\.)*)["']/m);
	if (slMatch) return slMatch[1].replace(/\\(["nrt])/g, (_, ch) =>
		ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch,
	);

	return undefined;
}

/**
 * Expand `{{args}}` placeholder in a Gemini command prompt.
 * If the prompt contains `{{args}}`, replace it with the user's args.
 * Otherwise, append args after two newlines (Gemini default behavior).
 */
function expandGeminiCommandPrompt(prompt: string, args: string): string {
	if (prompt.includes("{{args}}")) {
		return prompt.replace(/\{\{args}}/g, () => args);
	}
	if (args) {
		return prompt + "\n\n" + args;
	}
	return prompt;
}

function summarizeStderr(stderr: string): string {
	return stderr
		.split(/\r?\n/)
		.map((line) => compactWhitespace(line))
		.filter(Boolean)
		.slice(-2)
		.join(" | ");
}

function describePhase(phase: LivePhase): string {
	switch (phase) {
		case "starting":
			return "starting";
		case "initializing":
			return "initializing";
		case "authenticating":
			return "authenticating";
		case "loading-session":
			return "loading session";
		case "creating-session":
			return "creating session";
		case "sending-prompt":
			return "sending prompt";
		case "waiting":
			return "waiting";
		case "streaming":
			return "streaming";
		case "cancelling":
			return "cancelling";
		case "completed":
			return "completed";
		case "error":
			return "error";
	}
}

function pickYoloPermissionOption(options: PermissionOption[]): string | undefined {
	const scored = options
		.map((opt, idx) => {
			const id = opt.optionId || opt.id;
			const text = `${opt.name || ""} ${opt.title || ""} ${opt.label || ""} ${id || ""}`.toLowerCase();
			let score = 0;

			if (text.includes("reject") || text.includes("deny") || text.includes("cancel")) score -= 50;
			if (text.includes("allow")) score += 10;
			if (text.includes("session")) score += 25;
			if (text.includes("always")) score += 40;
			if (text.includes("all tools")) score += 60;
			if (text.includes("all")) score += 20;
			if (text.includes("yolo")) score += 100;

			return { id, score, idx };
		})
		.filter((x) => !!x.id)
		.sort((a, b) => b.score - a.score || a.idx - b.idx);

	const best = scored[0];
	return best && best.score >= 0 ? best.id : undefined;
}

function formatElapsed(ms: number): string {
	const sec = Math.max(0, Math.floor(ms / 1000));
	const min = Math.floor(sec / 60);
	const rem = sec % 60;
	return min > 0 ? `${min}m ${rem}s` : `${rem}s`;
}

function extractModelFromPromptResult(result: { _meta?: any } | undefined): string | undefined {
	const usage = result?._meta?.quota?.model_usage;
	if (Array.isArray(usage) && usage.length > 0 && typeof usage[0]?.model === "string") {
		return usage[0].model;
	}

	const model = result?._meta?.model;
	return typeof model === "string" ? model : undefined;
}

function quoteCmdArg(value: string): string {
	if (!value.length) return '""';
	if (!/[\s"&<>^|()]/.test(value)) return value;
	return `"${value.replace(/"/g, '""')}"`;
}

export function getGeminiLaunchSpec(
	bin: string,
	platform = process.platform,
	comspec = process.env.ComSpec || "cmd.exe",
): GeminiLaunchSpec {
	if (platform !== "win32") {
		return { command: bin, args: ["--acp"] };
	}

	const trimmedBin = bin.trim();
	const lowerBin = trimmedBin.toLowerCase();
	if (lowerBin.endsWith(".exe") || lowerBin.endsWith(".com")) {
		return { command: trimmedBin, args: ["--acp"] };
	}

	// npm-installed CLIs on Windows are commonly exposed as .cmd shims, which
	// need to be launched through cmd.exe to avoid ENOENT from spawn().
	return {
		command: comspec,
		args: ["/d", "/s", "/c", `${quoteCmdArg(trimmedBin)} --acp`],
	};
}

// Match the same wave animation used by pi-extensions/custom-ui.ts footer.
function getLoadingFrames(): string[] {
	return ["∼", "≈", "≋", "≈"];
}

export default function geminiAcpExtension(pi: ExtensionAPI) {
	const client = new AcpClient(pi);
	let state: GeminiState = { sessions: {} };
	let live: LiveRun | null = null;
	let liveCtx: any | null = null;
	let liveTicker: ReturnType<typeof setInterval> | null = null;
	let terminalInputCleanup: (() => void) | null = null;

	const publishUiState = (phase: "idle" | "waiting" | "streaming", sessionId?: string) => {
		pi.events.emit("gemini-acp:ui-state", { phase, sessionId, at: Date.now() });
	};

	pi.registerMessageRenderer("gemini-acp", (message, { expanded }, theme) => {
		const details = (message.details || {}) as {
			sessionId?: string;
			prompt?: string;
			answer?: string;
			thought?: string;
			events?: string[];
			model?: string;
			stopReason?: string;
		};

		if (!details.sessionId) {
			return new Text(String(message.content || ""), 0, 0);
		}

		const dim = (s: string) => theme.fg("dim", s);

		// Subtle header – dim bracketed text instead of accent color
		const header = dim(`[ Gemini ACP · ${details.sessionId} ]`);

		// Prompt as subtle "You:" label
		const prompt = details.prompt ? `\n${theme.bold("You:")} ${details.prompt.trim()}` : "";

		// Answer as main content with "Gemini:" label
		const answer = details.answer ? `\n${theme.bold("Gemini:")}\n${details.answer.trim()}` : "";

		// Timeline – dimmed blockquote style to subordinate meta-information
		let timeline = "";
		if (Array.isArray(details.events) && details.events.length) {
			const visible = expanded ? details.events : details.events.slice(-10);
			const lines = visible.map((e) => dim(`│ ${e}`)).join("\n");
			timeline = `\n\n${dim("Timeline:")}\n${lines}`;
			if (!expanded && details.events.length > visible.length) {
				timeline += `\n${dim(`│ … ${details.events.length - visible.length} more (expand to view all)`)}`;
			}
		}

		// Thought stream – dimmed blockquote style
		const thought = details.thought
			? `\n\n${dim("Thought stream:")}\n${dim(expanded ? details.thought.trim().split("\n").map((l: string) => `│ ${l}`).join("\n") : details.thought.trim().slice(0, 1200).split("\n").map((l: string) => `│ ${l}`).join("\n") + (details.thought.trim().length > 1200 ? "\n│ …" : ""))}`
			: "";

		// Metadata (model, stop reason) – moved to the end, dimmed
		const meta: string[] = [];
		if (details.model) meta.push(`Model: ${details.model}`);
		if (details.stopReason) meta.push(`Stop: ${details.stopReason}`);
		const metaStr = meta.length ? `\n\n${dim(meta.join(" · "))}` : "";

		// No background color, no extra padding – blend with native messages
		return new Text(`${header}${prompt}${answer}${timeline}${thought}${metaStr}`, 0, 0);
	});

	const persistState = () => {
		pi.appendEntry(STATE_ENTRY_TYPE, state);
	};

	const pushLiveEvent = (message: string) => {
		if (!live) return;
		const normalized = compactWhitespace(message);
		if (!normalized || live.lastEventMessage === normalized) return;

		live.lastEventMessage = normalized;
		live.events = trimLines(
			[...live.events, `[${formatElapsed(Date.now() - live.startedAt)}] ${normalized}`],
			40,
		);
	};

	const setLiveProgress = (phase: LivePhase, action: string, options?: { log?: boolean }) => {
		if (!live) return;
		live.phase = phase;
		live.currentAction = action;
		if (options?.log !== false) {
			pushLiveEvent(action);
		}
	};

	const updateUi = (ctx: any) => {
		if (!ctx) return;
		if (!live) {
			ctx.ui.setStatus(EXT_STATUS_KEY, "");
			ctx.ui.setWidget(EXT_WIDGET_KEY, []);
			return;
		}

		const elapsed = Date.now() - live.startedAt;
		const answerPreview = clipEnd(compactWhitespace(live.answer || ""), 240);
		const thoughtPreview = clipEnd(compactWhitespace(live.thought || ""), 240);
		const events = trimLines(live.events, 4);
		const stderrPreview = summarizeStderr(client.getStderrTail());

		const loadingFrames = getLoadingFrames();
		const spinner = loadingFrames[Math.floor(Date.now() / 120) % loadingFrames.length];

		const phaseLabel =
			live.phase === "completed"
				? "✓ completed"
				: live.phase === "error"
					? "✗ error"
					: `${spinner} ${describePhase(live.phase)}`;

		const status =
			live.phase === "completed"
				? `✓ Gemini ACP done • ${formatElapsed(elapsed)} • ${live.sessionId}`
				: live.phase === "error"
					? `✗ Gemini ACP error • ${formatElapsed(elapsed)} • ${clipEnd(compactWhitespace(live.error || live.currentAction), 44)}`
					: `${spinner} Gemini ACP ${describePhase(live.phase)} • ${formatElapsed(elapsed)} • ${clipEnd(compactWhitespace(live.currentAction), 52)}`;

		const clip = (s: string, max = 72) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
		const detailWidth = 86;

		const body = [
			`Gemini ACP · ${live.sessionId !== "(starting)" ? clip(live.sessionId, 48) : "starting"}`,
			`Status: ${phaseLabel} • ${formatElapsed(elapsed)}`,
			`Action: ${clip(compactWhitespace(live.currentAction || "(starting)"), detailWidth)}`,
		];

		if (live.model) {
			body.push(`Model: ${clip(live.model, 40)}`);
		}
		if (live.stopReason) {
			body.push(`Stop reason: ${clip(live.stopReason, 40)}`);
		}

		body.push(...formatSection("Prompt", live.prompt || "(resume only)", detailWidth, 2));

		if (live.error) {
			body.push(...formatSection("Error", live.error, detailWidth, 2));
		} else if (answerPreview) {
			body.push(...formatSection("Answer", answerPreview, detailWidth, 3));
		} else if (thoughtPreview) {
			body.push(...formatSection("Thinking", thoughtPreview, detailWidth, 3));
		} else if (live.phase === "waiting" || live.phase === "initializing" || live.phase === "authenticating") {
			body.push(...formatSection("Output", "waiting for model output", detailWidth, 1));
		}

		if (stderrPreview && (live.phase === "error" || !answerPreview)) {
			body.push(...formatSection("stderr", stderrPreview, detailWidth, 1));
		}

		if (events.length) {
			body.push("Recent:");
			for (const event of events) {
				body.push(`- ${clip(event, detailWidth)}`);
			}
		}

		ctx.ui.setStatus(EXT_STATUS_KEY, status);
		ctx.ui.setWidget(EXT_WIDGET_KEY, () => ({
			invalidate() {},
			render(width: number): string[] {
				return body.map((line) => truncateToWidth(line, Math.max(0, width)));
			},
		}));
	};

	const cancelLiveRun = async (ctx: any, source: "command" | "escape") => {
		if (!live?.running) {
			if (source === "command") {
				ctx.ui.notify("No Gemini run in progress", "info");
			}
			return;
		}

		if (live.phase === "cancelling") {
			return;
		}

		const currentSessionId = live.sessionId;
		const currentAction = source === "escape" ? "Cancel requested (Esc)" : "Cancel requested";
		live.running = false;
		setLiveProgress("cancelling", currentAction);
		updateUi(ctx);

		try {
			if (currentSessionId && currentSessionId !== "(starting)" && client.isRunning()) {
				await client.cancel(currentSessionId);
			} else {
				client.stop();
			}
			ctx.ui.notify(
				source === "escape" ? "Sent cancel to Gemini ACP via Esc" : "Sent cancel to Gemini ACP",
				"warning",
			);
		} catch (err) {
			client.stop();
			throw err;
		}
	};

	const startLiveTicker = () => {
		if (liveTicker) clearInterval(liveTicker);
		liveTicker = setInterval(() => {
			if (live && liveCtx) updateUi(liveCtx);
		}, 60);
	};

	const stopLiveTicker = () => {
		if (liveTicker) {
			clearInterval(liveTicker);
			liveTicker = null;
		}
	};

	const unsubscribeActivity = client.onActivity((activity) => {
		if (!live) return;
		setLiveProgress(activity.phase, activity.message);
		if (liveCtx) updateUi(liveCtx);
	});

	const unsubscribeNotifications = client.onNotification((method, params) => {
		if (!live) return;

		const p = params ?? {};
		const sid = p.sessionId;
		if (sid && sid !== live.sessionId) return;

		const update = p.update ?? p;
		const updateType = update?.sessionUpdate || update?.type || method;

		if (updateType === "agent_message_chunk") {
			const chunk = extractText(update?.content ?? update);
			if (chunk !== "") {
				if (!live.answerStarted) {
					live.answerStarted = true;
					setLiveProgress("streaming", "Streaming model answer");
					publishUiState("streaming", live.sessionId);
				}
				live.answer += chunk;
			}
		} else if (updateType === "agent_thought_chunk" || String(updateType).includes("thought")) {
			const chunk = extractText(update?.content ?? update);
			if (chunk) {
				setLiveProgress("streaming", "Streaming model reasoning", { log: !live.thoughtStarted });
				publishUiState("streaming", live.sessionId);
				live.thought += chunk;
				if (!live.thoughtStarted) {
					live.thoughtStarted = true;
					pushLiveEvent("Thought stream started");
				}
			}
		} else if (updateType === "tool_call") {
			const title = update?.toolCall?.title || update?.title || update?.toolName || "tool call";
			setLiveProgress("streaming", `Running tool: ${title}`);
			publishUiState("streaming", live.sessionId);
		} else if (updateType === "tool_call_update") {
			const toolStatus = update?.toolCall?.status || update?.status || "updated";
			const title = update?.toolCall?.title || update?.title || update?.toolName;
			setLiveProgress(
				"streaming",
				title ? `Tool update: ${title} -> ${toolStatus}` : `Tool update: ${toolStatus}`,
			);
			publishUiState("streaming", live.sessionId);
		} else if (updateType === "available_commands_update") {
			pushLiveEvent("Available Gemini commands updated");
		} else if (method === "requestPermission") {
			setLiveProgress("waiting", "Permission requested -> auto-approved (YOLO)");
		} else if (updateType && updateType !== "session/update") {
			pushLiveEvent(`Update received: ${updateType}`);
		}

		if (liveCtx) updateUi(liveCtx);
	});

	pi.on("session_start", async (_event, ctx) => {
		state = restoreState(ctx);
		ctx.ui.setStatus(EXT_STATUS_KEY, "Gemini ACP idle");
		ctx.ui.setWidget(EXT_WIDGET_KEY, []);

		terminalInputCleanup?.();
		if (typeof ctx.ui.onTerminalInput === "function") {
			terminalInputCleanup = ctx.ui.onTerminalInput((data: string) => {
				if (!live?.running) return undefined;
				if (isKeyRelease(data)) return undefined;
				if (!matchesKey(data, "escape")) return undefined;

				void cancelLiveRun(liveCtx || ctx, "escape").catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					const targetCtx = liveCtx || ctx;
					if (live) {
						live.phase = "error";
						live.currentAction = "Gemini ACP run failed during cancel";
						live.error = message;
						pushLiveEvent(`Error: ${message}`);
						updateUi(targetCtx);
					}
					targetCtx.ui.notify(`Gemini ACP error: ${message}`, "error");
				});
				return { consume: true };
			});
		}
	});

	pi.on("session_shutdown", async () => {
		stopLiveTicker();
		terminalInputCleanup?.();
		terminalInputCleanup = null;
		client.stop();
	});

	pi.registerCommand("gemini", {
		description:
			"Run Gemini via ACP (/gemini <prompt> | new <prompt> | cmd <name> [args...] | resume <sessionId> [prompt] | stop | status | sessions)",
		async handler(args: string, ctx: any) {
			const raw = args.trim();
			if (!raw) {
				ctx.ui.notify(
					"Usage: /gemini <prompt> | /gemini new <prompt> | /gemini cmd <name> [args...] | /gemini resume <sessionId> [prompt] | /gemini stop | /gemini status | /gemini sessions",
					"info",
				);
				return;
			}

			const [sub, ...rest] = raw.split(/\s+/);

			if (sub === "stop") {
				await cancelLiveRun(ctx, "command");
				return;
			}

			if (sub === "status") {
				const status = [
					`process: ${client.isRunning() ? "running" : "stopped"}`,
					`current session: ${state.currentSessionId ?? "(none)"}`,
					`permissions: YOLO auto-approve`,
					`known sessions: ${Object.keys(state.sessions).length}`,
					live ? `active run: ${live.running ? "running" : "done"}` : "active run: none",
					...(live
						? [
							`phase: ${describePhase(live.phase)}`,
							`current action: ${live.currentAction}`,
							...(live.model ? [`model: ${live.model}`] : []),
							...(live.stopReason ? [`stop reason: ${live.stopReason}`] : []),
							`recent events: ${trimLines(live.events, 8).length}`,
						]
						: []),
				].join("\n");

				const recentEvents = live ? trimLines(live.events, 8).map((event) => `- ${event}`).join("\n") : "";

				const stderr = client.getStderrTail();
				pi.sendMessage(
					{
						customType: "gemini-acp",
						content: `### Gemini ACP Status\n\n${status}${recentEvents ? `\n\n### Recent events\n\n${recentEvents}` : ""}${stderr ? `\n\n### stderr (tail)\n\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
						display: true,
					},
					{ triggerTurn: false },
				);
				return;
			}



			if (sub === "sessions") {
				const sessions = Object.entries(state.sessions)
					.sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
					.map(
						([id, meta]) =>
							`- ${id}  (${new Date(meta.lastUsedAt).toLocaleString()})  cwd=${meta.cwd}${meta.model ? `  model=${meta.model}` : ""}`,
					)
					.join("\n");

				pi.sendMessage(
					{
						customType: "gemini-acp",
						content: `### Gemini Sessions\n\n${sessions || "(none)"}`,
						display: true,
					},
					{ triggerTurn: false },
				);
				return;
			}

			if (ctx.isIdle && typeof ctx.isIdle === "function" && !ctx.isIdle()) {
				ctx.ui.notify("Pi is currently busy. Wait for current turn to finish.", "warning");
				return;
			}

			if (live?.running) {
				ctx.ui.notify("Gemini ACP is already running. Please wait or use /gemini stop.", "warning");
				return;
			}

			let mode: "default" | "new" | "resume" | "cmd" = "default";
			let sessionIdArg: string | undefined;
			let promptText = raw;

			if (sub === "new") {
				mode = "new";
				promptText = rest.join(" ").trim();
			} else if (sub === "resume") {
				mode = "resume";
				sessionIdArg = rest[0];
				promptText = rest.slice(1).join(" ").trim();
				if (!sessionIdArg) {
					ctx.ui.notify("Usage: /gemini resume <sessionId> [prompt]", "error");
					return;
				}
			} else if (sub === "cmd") {
				const cmdName = rest[0];
				if (!cmdName) {
					ctx.ui.notify("Usage: /gemini cmd <command-name> [args...]\nResolves a custom Gemini .toml command and runs it via ACP.", "info");
					return;
				}

				const cmdArgs = rest.slice(1).join(" ");
				const expanded = resolveGeminiCommand(cmdName, cmdArgs, ctx.cwd);
				if (!expanded) {
					ctx.ui.notify(`Gemini command not found: ${cmdName}\nLooked in .gemini/commands/ and ~/.gemini/commands/`, "error");
					return;
				}

				ctx.ui.notify(`Resolved Gemini command /${cmdName} — sending expanded prompt via ACP`, "info");

				mode = "cmd";
				promptText = expanded;
			}

			if (!promptText && mode !== "resume") {
				ctx.ui.notify("Prompt cannot be empty", "error");
				return;
			}

			try {
				// Optimistic UI: show activity immediately so Enter doesn't feel frozen.
				liveCtx = ctx;
				live = {
					sessionId: sessionIdArg || state.currentSessionId || "(starting)",
					startedAt: Date.now(),
					prompt: promptText || "(resume only)",
					answer: "",
					answerStarted: false,
					thought: "",
					thoughtStarted: false,
					events: [],
					running: true,
					phase: "starting",
					currentAction: "Launching Gemini ACP",
				};
				pushLiveEvent("Launching Gemini ACP");
				startLiveTicker();
				publishUiState("waiting", live.sessionId);
				updateUi(ctx);

				let sessionId: string;

				if (mode === "new") {
					sessionId = await client.ensureSession(ctx.cwd);
				} else if (mode === "resume") {
					sessionId = await client.ensureSession(ctx.cwd, sessionIdArg, { explicitResume: true });
				} else {
					sessionId = await client.ensureSession(ctx.cwd, state.currentSessionId);
				}

				state.currentSessionId = sessionId;
				state.sessions[sessionId] = { lastUsedAt: Date.now(), cwd: ctx.cwd };
				persistState();

				// Update optimistic placeholder session id with actual id.
				if (live) {
					live.sessionId = sessionId;
					setLiveProgress("waiting", `Gemini session ready: ${sessionId}`);
				}

				if (!promptText) {
					stopLiveTicker();
					publishUiState("idle", sessionId);
					live = null;
					liveCtx = null;
					updateUi(ctx);
					ctx.ui.notify(`Resumed Gemini session ${sessionId}`, "success");
					return;
				}

				if (live) {
					setLiveProgress("waiting", "Waiting for Gemini response");
				}
				publishUiState("waiting", sessionId);
				updateUi(ctx);

				const result = await client.prompt(sessionId, promptText);
				const usedModel = extractModelFromPromptResult(result);

				live.running = false;
				live.phase = "completed";
				live.currentAction = "Gemini run completed";
				live.stopReason = result?.stopReason;
				if (usedModel) {
					live.model = usedModel;
					pushLiveEvent(`Model used: ${usedModel}`);
				}
				pushLiveEvent(`Prompt completed${result?.stopReason ? ` (${result.stopReason})` : ""}`);
				state.sessions[sessionId] = { lastUsedAt: Date.now(), cwd: ctx.cwd, model: usedModel };
				persistState();
				stopLiveTicker();
				publishUiState("idle", sessionId);
				updateUi(ctx);

				const answer = live.answer.trim() || "(no streamed text returned)";
				const thought = live.thought.trim();

				const model = state.sessions[sessionId]?.model;

				// Rich display message for the UI widget (not injected into Pi's context)
				let displayContent = `### Gemini (${sessionId})\n\n**Prompt**\n\n${promptText}\n\n**Answer**\n\n${answer}`;
				if (thought) {
					displayContent += `\n\n<details><summary>Thought stream</summary>\n\n${thought}\n\n</details>`;
				}

				pi.sendMessage(
					{
						customType: "gemini-acp",
						content: displayContent,
						display: true,
						details: {
							sessionId,
							prompt: promptText,
							answer,
							thought,
							events: live.events,
							model,
							stopReason: live.stopReason,
						},
					},
					{ triggerTurn: false },
				);

				const finalSessionId = sessionId;

				// Hidden context message for Pi's LLM. Keep the Gemini result available
				// in context, but steer Pi toward asking the user what to do next
				// instead of summarizing or re-running the completed task.
				const contextContent = `[Gemini ACP completed] Gemini already executed this task${model ? ` (${model})` : ""}. Do NOT re-run it. Treat the Gemini output below as background context only.

Your next visible response must be brief and should NOT summarize, restate, analyze, or transform the Gemini result. Instead, tell the user the Gemini result is ready and ask what they want to do with it next.

Original task:
${promptText}

Gemini result:
=== GEMINI OUTPUT START ===
${answer}
=== GEMINI OUTPUT END ===`;

				pi.sendMessage(
					{
						customType: "gemini-acp-context",
						content: contextContent,
						display: false,
					},
					{ triggerTurn: true },
				);
			} catch (err) {
				if (live) {
					live.running = false;
					live.phase = "error";
					live.currentAction = "Gemini ACP run failed";
					live.error = err instanceof Error ? err.message : String(err);
					pushLiveEvent(`Error: ${live.error}`);
					stopLiveTicker();
					updateUi(ctx);
				}
				ctx.ui.notify(`Gemini ACP error: ${err instanceof Error ? err.message : String(err)}`, "error");
			} finally {
				const lastSessionId = live?.sessionId;
				stopLiveTicker();
				publishUiState("idle", lastSessionId);
				live = null;
				liveCtx = null;
				updateUi(ctx);
			}
		},
	});
}
