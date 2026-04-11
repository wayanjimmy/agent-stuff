/**
 * gemini extension
 *
 * Slash commands:
 *   /gemini <prompt>                    - Run prompt in current/resumed session
 *   /gemini:new <prompt>                - Start a new session with prompt
 *   /gemini:resume <sessionId> [prompt] - Resume a session, optionally with prompt
 *   /gemini:cmd <name> [args...]        - Run a custom .toml command
 *   /gemini:cmd:<name> [args...]        - Run a discovered custom command directly
 *   /gemini:stop                        - Cancel current run
 *   /gemini:status                      - Show process/session status
 *   /gemini:sessions                    - List known sessions
 *
 * Tools (LLM-callable):
 *   ask_gemini_cmd_<name>   - Dynamic tool per discovered custom command
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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type AgentToolResult,
  type AgentToolUpdateCallback,
} from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth, isKeyRelease, matchesKey } from "@mariozechner/pi-tui";

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

type geminiState = {
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

type geminiToolDetails = {
  sessionId?: string;
  phase?: LivePhase;
  model?: string;
  stopReason?: string;
  commandName?: string;
  prompt?: string;
};

type LiveRun = {
  sessionId: string;
  startedAt: number;
  prompt: string;
  answer: string;
  answerStarted: boolean;
  thought: string;
  thoughtStarted: boolean;
  events: string[];
	recentActions: string[];
  running: boolean;
  phase: LivePhase;
  currentAction: string;
  model?: string;
  stopReason?: string;
  error?: string;
  lastEventMessage?: string;
  onUpdate?: AgentToolUpdateCallback<geminiToolDetails>;
  _lastToolUpdate?: number;
};

type PermissionOption = {
  optionId?: string;
  id?: string;
  name?: string;
  title?: string;
  label?: string;
};
type geminiLaunchSpec = { command: string; args: string[] };
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

  constructor(private readonly pi: ExtensionAPI) {}

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
    this.emitActivity("authenticating", "Authenticating gemini session");
    await this.authenticateIfConfigured();
    this.ready = true;
    this.emitActivity("waiting", "gemini client is ready");
  }

  async ensureSession(
    cwd: string,
    sessionId?: string,
    options?: { explicitResume?: boolean },
  ): Promise<string> {
    await this.ensureReady(cwd);

    if (sessionId) {
      if (!this.loadedSessions.has(sessionId)) {
        try {
          this.emitActivity("loading-session", `Loading gemini session ${sessionId}`);
          await this.request(
            "session/load",
            { sessionId, cwd, mcpServers: [] },
            DEFAULT_TIMEOUT_MS,
          );
          this.loadedSessions.add(sessionId);
          this.emitActivity("waiting", `Loaded gemini session ${sessionId}`);
          return sessionId;
        } catch (err) {
          if (options?.explicitResume) {
            throw new Error(
              `Failed to resume session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          this.emitActivity(
            "creating-session",
            `Could not load ${sessionId}; creating a new gemini session`,
          );
          // Automatic resume path: fall through to creating a new session.
        }
      } else {
        this.emitActivity("waiting", `Using already loaded gemini session ${sessionId}`);
        return sessionId;
      }
    }

    this.emitActivity("creating-session", "Creating a new gemini session");
    const created = (await this.request(
      "session/new",
      { cwd, mcpServers: [] },
      DEFAULT_TIMEOUT_MS,
    )) as {
      sessionId?: string;
    };
    if (!created?.sessionId) {
      throw new Error("ACP newSession did not return a sessionId");
    }
    this.loadedSessions.add(created.sessionId);
    this.emitActivity("waiting", `Created gemini session ${created.sessionId}`);
    return created.sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason?: string; _meta?: any }> {
    this.emitActivity("sending-prompt", `Sending prompt to gemini session ${sessionId}`);
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
    this.emitActivity("cancelling", `Cancelling gemini session ${sessionId}`);
    await this.notify("session/cancel", { sessionId });
  }

  stop(): void {
    if (this.proc && !this.proc.killed) {
      this.terminateProcess(this.proc);
    }
    this.teardown(new Error("gemini process stopped"));
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
    const launch = getgeminiLaunchSpec(bin);
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
      this.teardown(
        new Error(`gemini exited (code=${code ?? "null"}, signal=${signal ?? "null"})`),
      );
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
      const options = (request.params?.options ||
        request.params?.permissionOptions ||
        []) as PermissionOption[];
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

      // Prefer existing gemini CLI OAuth session when no API key is provided.
      await this.request("authenticate", { methodId: "oauth-personal" }, DEFAULT_TIMEOUT_MS);
    } catch {
      // Non-fatal: session/new will surface a clearer auth error if this fails.
    }
  }

  private request(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
      throw new Error("gemini process is not available");
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

function restoreState(ctx: any): geminiState {
  const state: geminiState = { sessions: {} };
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
    const data = entry.data as geminiState | undefined;
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

function formatLabeledBlock(
  label: string,
  value: string,
  width: number,
  maxLines: number,
): string[] {
  const normalized = compactWhitespace(value);
  if (!normalized) return [];

  const available = Math.max(16, width - label.length - 2);
  const wrapped = wrapText(normalized, available);
  const visible = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines && visible.length > 0) {
    visible[visible.length - 1] =
      clipEnd(visible[visible.length - 1], Math.max(4, available - 1)) + "…";
  }

  return visible.map((line, idx) => `${idx === 0 ? `${label}:` : "  "} ${line}`);
}

function formatSection(label: string, value: string, width: number, maxLines: number): string[] {
  const normalized = compactWhitespace(value);
  if (!normalized) return [];

  const wrapped = wrapText(normalized, Math.max(16, width));
  const visible = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines && visible.length > 0) {
    visible[visible.length - 1] =
      clipEnd(visible[visible.length - 1], Math.max(4, width - 1)) + "…";
  }

  return [`${label}:`, ...visible];
}

// ---------------------------------------------------------------------------
// Bordered box widget helpers
// ---------------------------------------------------------------------------

const ACCENT = "\x1b[38;2;77;163;255m";
const DIM = "\x1b[38;2;120;120;140m";
const RESET = "\x1b[0m";

/** Wrap text in soft-blue accent color. */
function accent(text: string): string {
	return `${ACCENT}${text}${RESET}`;
}

/** Pad text with spaces based on visibleWidth (ANSI-safe). */
function padVisible(text: string, targetWidth: number): string {
	const vw = visibleWidth(text);
	const gap = Math.max(0, targetWidth - vw);
	return text + " ".repeat(gap);
}

/** Truncate text to fit within maxWidth, ANSI-safe. */
function fitVisible(text: string, maxWidth: number): string {
	return truncateToWidth(text, Math.max(0, maxWidth));
}

const STARTING_PHASES: ReadonlySet<LivePhase> = new Set([
	"starting",
	"initializing",
	"authenticating",
	"loading-session",
	"creating-session",
	"sending-prompt",
]);

/** Build top border: `╭─ title ───── elapsed ╮` */
function renderBoxTop(title: string, elapsed: string, width: number): string {
	const inner = width - 2; // subtract corners
	const elapsedStr = `${elapsed}`;
	const minDashes = 2;
	const titlePart = ` ${title} `;
	const elapsedPart = ` ${elapsedStr} `;

	// Measure visible widths (title/accent has ANSI codes)
	const titleVw = visibleWidth(titlePart);
	const elapsedVw = visibleWidth(elapsedPart);

	const dashesAvailable = inner - titleVw - elapsedVw;
	if (dashesAvailable < minDashes) {
		// Degraded: just fill with dashes
		return accent(`╭${"─".repeat(Math.max(0, inner))}╮`);
	}

	const leftDashes = Math.ceil(dashesAvailable / 2);
	const rightDashes = dashesAvailable - leftDashes;

	const left = "─".repeat(leftDashes);
	const right = "─".repeat(rightDashes);

	return accent(`╭${left}${titlePart}${right}${elapsedPart}╮`);
}

/** Build body row: `│  content...     │` with accent-colored borders. */
function renderBoxRow(content: string, width: number): string {
	const contentArea = width - 4; // │ + space + content + space + │
	if (contentArea <= 0) {
		return accent(`${"│".padEnd(Math.max(0, width - 1))}│`);
	}
	const fitted = fitVisible(content, contentArea);
	const padded = padVisible(fitted, contentArea);
	return `${accent("│")} ${padded} ${accent("│")}`;
}

/** Build bottom border: `╰─────────────────╯` */
function renderBoxBottom(width: number): string {
	const inner = Math.max(0, width - 2);
	return accent(`╰${"─".repeat(inner)}╯`);
}

/** Push a cleaned-up action string onto recentActions (max 4, dedup consecutive). */
function pushRecentAction(live: LiveRun, message: string): void {
	let cleaned = compactWhitespace(message);
	// Strip common prefixes for cleaner bullets
	cleaned = cleaned.replace(/^Running tool:\s*/i, "");
	if (!cleaned) return;

	const last = live.recentActions[live.recentActions.length - 1];
	if (last === cleaned) return; // dedup consecutive

	live.recentActions.push(cleaned);
	if (live.recentActions.length > 4) {
		live.recentActions = live.recentActions.slice(-4);
	}
}

/** Main widget entry: returns full string[] for the bordered box. */
function rendergeminiWidgetBox(live: LiveRun, width: number, spinner: string): string[] {
	// Narrow-width fallback
	if (width < 20) {
		const elapsed = formatElapsed(Date.now() - live.startedAt);
		const label = buildPhaseLabel(live.phase, spinner);
		return [fitVisible(`gemini ${elapsed} ${label}`, width)];
	}

	const elapsed = formatElapsed(Date.now() - live.startedAt);
	const title = "gemini";
	const lines: string[] = [];

	lines.push(renderBoxTop(title, elapsed, width));

	// Always show bullet list with actions for better visibility
	const actions = live.recentActions;
	if (actions.length > 0) {
		const shown = actions.slice(-3);
		for (const action of shown) {
			lines.push(renderBoxRow(`- ${action}`, width));
		}
	} else if (live.currentAction) {
		// Fallback: show currentAction as a single bullet
		lines.push(renderBoxRow(`- ${compactWhitespace(live.currentAction)}`, width));
	}

	// Show current phase in dim if we're in a starting phase
	if (STARTING_PHASES.has(live.phase)) {
		const phaseLabel = `${spinner} ${describePhase(live.phase)}`;
		lines.push(renderBoxRow(`${DIM}${phaseLabel}${RESET}`, width));
	}

	lines.push(renderBoxBottom(width));
	return lines;
}

// ---------------------------------------------------------------------------
// gemini custom command (.toml) resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a gemini custom command by name.
 * Looks in project `.gemini/commands/` first, then user `~/.gemini/commands/`.
 * Namespacing: "git:commit" -> `commands/git/commit.toml`.
 * Returns the expanded prompt text with `{{args}}` replaced, or undefined.
 */
function resolvegeminiCommand(name: string, args: string, cwd: string): string | undefined {
  const candidates = buildCommandPaths(name, cwd);
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, "utf8");
      const prompt = extractTomlPrompt(raw);
      if (!prompt) continue;
      return expandgeminiCommandPrompt(prompt, args);
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
  // Multi-line triple-quoted prompt — closing """ must be at end of line (standard TOML)
  const mlMatch = tomlSource.match(/^\s*prompt\s*=\s*"""([\s\S]*?)"""\s*$/m);
  if (mlMatch) return mlMatch[1];

  // Single-line quoted prompt
  const slMatch = tomlSource.match(/^\s*prompt\s*=\s*["']((?:[^"\\]|\\.)*)["']/m);
  if (slMatch)
    return slMatch[1].replace(/\\(["nrt])/g, (_, ch) =>
      ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch,
    );

  return undefined;
}

/**
 * Expand `{{args}}` placeholder in a gemini command prompt.
 * If the prompt contains `{{args}}`, replace it with the user's args.
 * Otherwise, append args after two newlines (gemini default behavior).
 */
function expandgeminiCommandPrompt(prompt: string, args: string): string {
  if (prompt.includes("{{args}}")) {
    return prompt.replace(/\{\{args}}/g, () => args);
  }
  if (args) {
    return prompt + "\n\n" + args;
  }
  return prompt;
}

/**
 * Scan `.gemini/commands/` directories (project and home) for `.toml` files
 * and return their logical command names (e.g. "git:commit" for `git/commit.toml`).
 */
function discovergeminiCommandNames(cwd: string): string[] {
  const dirs = [join(cwd, ".gemini", "commands"), join(homedir(), ".gemini", "commands")];

  const seen = new Set<string>();

  const walk = (base: string, prefix: string) => {
    let dirents;
    try {
      dirents = readdirSync(join(base, prefix), { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      const entryName = dirent.name;
      const rel = prefix ? `${prefix}/${entryName}` : entryName;

      if (dirent.isDirectory()) {
        walk(base, rel);
      } else if (entryName.endsWith(".toml")) {
        const name = rel.replace(/\.toml$/, "").replace(/\//g, ":");
        if (/^[a-zA-Z0-9_:-]+$/.test(name)) {
          seen.add(name);
        }
      }
    }
  };

  for (const dir of dirs) {
    walk(dir, "");
  }

  return [...seen].sort();
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
      const text =
        `${opt.name || ""} ${opt.title || ""} ${opt.label || ""} ${id || ""}`.toLowerCase();
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

export function getgeminiLaunchSpec(
  bin: string,
  platform = process.platform,
  comspec = process.env.ComSpec || "cmd.exe",
): geminiLaunchSpec {
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

// Spinner icon: ✦ when actively working, ◇ when idle/ready.
function getSpinnerIcon(phase: LivePhase): string {
	switch (phase) {
		case "waiting":
		case "streaming":
		case "cancelling":
		case "error":
			return "✦";
		default:
			return "◇";
	}
}

// Build phase label for widget display (not status bar)
function buildPhaseLabel(phase: LivePhase, spinner: string): string {
	if (phase === "completed") {
		return "✓ completed";
	}
	if (phase === "error") {
		return "✗ error";
	}
	return `${spinner} ${describePhase(phase)}`;
}

// Build minimal status bar text (Option 2 style)
function buildMinimalStatus(phase: LivePhase, spinner: string): string {
	if (phase === "completed") {
		return "";
	}
	if (phase === "error") {
		return "✗ gemini";
	}
	return `${spinner} gemini`;
}

// ---------------------------------------------------------------------------
// Message renderer helpers
// ---------------------------------------------------------------------------

/** Status icon: ✦ while working, ◇ when done/idle. */
function geminiStatusIcon(phase: string | undefined): string {
  if (phase && phase !== "completed" && phase !== "error") return "✦";
  return "◇";
}

/** Truncate session ID to first4…last4 format. */
function shortSessionId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** Build the standard header line: icon + toolTitle + dim metadata. */
function buildgeminiHeader(
  details: { sessionId?: string; model?: string; stopReason?: string; phase?: string },
  theme: Theme,
): string {
  const icon = geminiStatusIcon(details.phase);
  let header = `${icon} ${theme.fg("toolTitle", theme.bold("gemini_acp"))}`;
  if (details.sessionId) {
    header += theme.fg("dim", ` · session ${shortSessionId(details.sessionId)}`);
  }
  if (details.model) {
    header += theme.fg("dim", ` · ${details.model}`);
  }
  if (details.stopReason) {
    header += theme.fg("dim", ` · ${details.stopReason}`);
  }
  return header;
}

export default function geminiAcpExtension(pi: ExtensionAPI) {
  const client = new AcpClient(pi);
  let state: geminiState = { sessions: {} };
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
      phase?: string;
    };

    // Fallback for non-session messages (e.g. /gemini:status, /gemini:sessions)
    if (!details.sessionId) {
      const mdTheme = getMarkdownTheme();
      return new Markdown(String(message.content || "(no output)"), 0, 0, mdTheme);
    }

    const dim = (s: string) => theme.fg("dim", s);
    const header = buildgeminiHeader(details, theme);

    // --- Collapsed view ---
    if (!expanded) {
      let text = header;

      // Prompt preview (dim, single line)
      if (details.prompt) {
        const promptPreview =
          details.prompt.trim().length > 80
            ? details.prompt.trim().slice(0, 80) + "…"
            : details.prompt.trim();
        text += `\n${theme.bold("You:")} ${dim(promptPreview)}`;
      }

      // Answer preview (first ~200 chars, plain text)
      if (details.answer) {
        const answerPreview =
          details.answer.trim().length > 200
            ? details.answer.trim().slice(0, 200) + "…"
            : details.answer.trim();
        text += `\n\n${answerPreview}`;
      }

      // Hint about hidden content
      const hiddenParts: string[] = [];
      if (details.events?.length) {
        hiddenParts.push(`${details.events.length} events`);
      }
      if (details.thought) {
        hiddenParts.push("thought stream");
      }
      if (hiddenParts.length) {
        text += `\n\n${dim(`(${hiddenParts.join(" · ")} · ctrl+o to expand)`)}`;
      }

      return new Text(text, 0, 0);
    }

    // --- Expanded view ---
    const mdTheme = getMarkdownTheme();
    const container = new Container();

    // Header
    container.addChild(new Text(header, 0, 0));
    container.addChild(new Spacer(1));

    // Prompt
    if (details.prompt) {
      container.addChild(new Text(`${theme.bold("You:")} ${details.prompt.trim()}`, 0, 0));
      container.addChild(new Spacer(1));
    }

    // Answer as Markdown
    const answerText = details.answer?.trim() || "(no response)";
    container.addChild(new Markdown(answerText, 0, 0, mdTheme));

    // Timeline (dimmed)
    if (details.events?.length) {
      container.addChild(new Spacer(1));
      const timelineLines = details.events.map((e) => dim(`│ ${e}`)).join("\n");
      container.addChild(new Text(`${dim("Timeline:")}\n${timelineLines}`, 0, 0));
    }

    // Thought stream (dimmed, capped at ~3000 chars)
    if (details.thought) {
      container.addChild(new Spacer(1));
      const cap = 3000;
      let thoughtBody = details.thought.trim();
      if (thoughtBody.length > cap) {
        thoughtBody = thoughtBody.slice(0, cap) + "\n…(truncated)";
      }
      const thoughtLines = thoughtBody
        .split("\n")
        .map((l: string) => `│ ${l}`)
        .join("\n");
      container.addChild(new Text(`${dim("Thought stream:")}\n${dim(thoughtLines)}`, 0, 0));
    }

    return container;
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
    pushRecentAction(live, action);
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

    const spinner = getSpinnerIcon(live.phase);

    const status = buildMinimalStatus(live.phase, spinner);

    ctx.ui.setStatus(EXT_STATUS_KEY, status);
    ctx.ui.setWidget(EXT_WIDGET_KEY, () => ({
      invalidate() {},
      render(width: number): string[] {
        return rendergeminiWidgetBox(live!, width, spinner);
      },
    }));
  };

  const cancelLiveRun = async (ctx: any, source: "command" | "escape") => {
    if (!live?.running) {
      if (source === "command") {
        ctx.ui.notify("No gemini run in progress", "info");
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
        source === "escape" ? "Sent cancel to gemini via Esc" : "Sent cancel to gemini",
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
        // Stream answer chunks to the active tool caller (throttled to ~5 updates/sec)
        const now = Date.now();
        if (!live._lastToolUpdate || now - live._lastToolUpdate > 200) {
          live._lastToolUpdate = now;
          live.onUpdate?.({
            content: [{ type: "text", text: live.answer }],
            details: { sessionId: live.sessionId, phase: "streaming" },
          });
        }
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
        // Stream thought chunks to the active tool caller (throttled)
        const now = Date.now();
        if (!live._lastToolUpdate || now - live._lastToolUpdate > 200) {
          live._lastToolUpdate = now;
          live.onUpdate?.({
            content: [{ type: "text", text: `[thinking] ${live.thought}` }],
            details: { sessionId: live.sessionId, phase: "streaming" },
          });
        }
      }
    } else if (updateType === "tool_call") {
      const title = update?.toolCall?.title || update?.title || update?.toolName || "tool call";
      setLiveProgress("streaming", `Running tool: ${title}`);
      publishUiState("streaming", live.sessionId);
      live.onUpdate?.({
        content: [{ type: "text", text: `[tool] ${title}` }],
        details: { sessionId: live.sessionId, phase: "streaming" },
      });
    } else if (updateType === "tool_call_update") {
      const toolStatus = update?.toolCall?.status || update?.status || "updated";
      const title = update?.toolCall?.title || update?.title || update?.toolName;
      setLiveProgress(
        "streaming",
        title ? `Tool update: ${title} -> ${toolStatus}` : `Tool update: ${toolStatus}`,
      );
      publishUiState("streaming", live.sessionId);
    } else if (updateType === "available_commands_update") {
      pushLiveEvent("Available gemini commands updated");
    } else if (method === "requestPermission") {
      setLiveProgress("waiting", "Permission requested -> auto-approved (YOLO)");
    } else if (updateType && updateType !== "session/update") {
      pushLiveEvent(`Update received: ${updateType}`);
    }

    if (liveCtx) updateUi(liveCtx);
  });

  pi.on("session_start", async (_event, ctx) => {
    state = restoreState(ctx);
    ctx.ui.setStatus(EXT_STATUS_KEY, "◇ gemini");
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
            live.currentAction = "gemini run failed during cancel";
            live.error = message;
            pushLiveEvent(`Error: ${message}`);
            updateUi(targetCtx);
          }
          targetCtx.ui.notify(`gemini error: ${message}`, "error");
        });
        return { consume: true };
      });
    }
  });

  pi.on("session_shutdown", async () => {
    stopLiveTicker();
    terminalInputCleanup?.();
    terminalInputCleanup = null;
    unsubscribeActivity();
    unsubscribeNotifications();
    client.stop();
  });

  // ---------------------------------------------------------------------------
  // Extracted command helpers
  // ---------------------------------------------------------------------------

  const showStatus = () => {
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

    const recentEvents = live
      ? trimLines(live.events, 8)
          .map((event) => `- ${event}`)
          .join("\n")
      : "";

    const stderr = client.getStderrTail();
    pi.sendMessage(
      {
        customType: "gemini-acp",
        content: `### gemini status\n\n${status}${recentEvents ? `\n\n### recent events\n\n${recentEvents}` : ""}${stderr ? `\n\n### stderr (tail)\n\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
        display: true,
      },
      { triggerTurn: false },
    );
  };

  const showSessions = () => {
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
        content: `### gemini sessions\n\n${sessions || "(none)"}`,
        display: true,
      },
      { triggerTurn: false },
    );
  };

  type geminiRunOpts = {
    prompt?: string;
    forceNewSession?: boolean;
    explicitSessionId?: string;
    explicitResume?: boolean;
  };

  type geminiRunResult = {
    sessionId: string;
    prompt: string;
    answer: string;
    thought: string;
    events: string[];
    model?: string;
    stopReason?: string;
  };

  type geminiRunHooks = {
    onUpdate?: AgentToolUpdateCallback<geminiToolDetails>;
    signal?: AbortSignal;
  };

  // ---------------------------------------------------------------------------
  // Tool parameter schemas
  // ---------------------------------------------------------------------------

  const dynamicGeminiCmdParams = Type.Object({
    args: Type.Optional(Type.String({ description: "Arguments to pass to the command" })),
  });

  type dynamicGeminiCmdParamsType = Static<typeof dynamicGeminiCmdParams>;

  // ---------------------------------------------------------------------------
  // Shared run logic (no Pi messages)
  // ---------------------------------------------------------------------------

  /**
   * Core gemini execution. Runs the prompt through the ACP client,
   * tracks live state, and returns a structured result.
   * Does NOT send Pi messages — callers handle result delivery.
   */
  const performgeminiRun = async (
    opts: geminiRunOpts,
    ctx: any,
    hooks?: geminiRunHooks,
  ): Promise<geminiRunResult> => {
    // Concurrency guard — only one gemini run at a time
    if (live?.running) {
      throw new Error("gemini is already running. Please wait or use /gemini:stop.");
    }

    const promptText = opts.prompt;
    const sessionIdArg = opts.explicitSessionId;

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
      recentActions: [],
      running: true,
      phase: "starting",
      currentAction: "launching gemini",
      onUpdate: hooks?.onUpdate,
    };
    pushRecentAction(live, "launching gemini");
    pushLiveEvent("launching gemini");
    startLiveTicker();
    publishUiState("waiting", live.sessionId);
    updateUi(ctx);

    hooks?.onUpdate?.({
      content: [{ type: "text", text: "starting gemini..." }],
      details: { phase: "starting" },
    });

    // Wire abort signal to cancel the live run
    const onAbort = () => {
      if (!live?.running) return;
      const sid = live.sessionId;
      live.running = false;
      setLiveProgress("cancelling", "Tool execution cancelled");
      if (sid && sid !== "(starting)" && client.isRunning()) {
        client.cancel(sid).catch(() => {
          /* best effort */
        });
      } else {
        client.stop();
      }
    };
    hooks?.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      // Session management
      let sessionId: string;
      if (opts.forceNewSession) {
        sessionId = await client.ensureSession(ctx.cwd);
      } else if (opts.explicitResume) {
        sessionId = await client.ensureSession(ctx.cwd, sessionIdArg, { explicitResume: true });
      } else {
        sessionId = await client.ensureSession(ctx.cwd, state.currentSessionId);
      }

      state.currentSessionId = sessionId;
      state.sessions[sessionId] = { lastUsedAt: Date.now(), cwd: ctx.cwd };
      persistState();

      if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      if (live) {
        live.sessionId = sessionId;
        setLiveProgress("waiting", `gemini session ready: ${sessionId}`);
      }

      hooks?.onUpdate?.({
        content: [{ type: "text", text: `Session ready: ${sessionId}. Sending prompt...` }],
        details: { sessionId, phase: "waiting" },
      });

      // Resume-only (no prompt)
      if (!promptText) {
        stopLiveTicker();
        publishUiState("idle", sessionId);
        return {
          sessionId,
          prompt: "(resume only)",
          answer: "",
          thought: "",
          events: live?.events ?? [],
        };
      }

      if (live) {
        setLiveProgress("waiting", "Waiting for gemini response");
      }
      publishUiState("waiting", sessionId);
      updateUi(ctx);

      hooks?.onUpdate?.({
        content: [{ type: "text", text: "Waiting for gemini response..." }],
        details: { sessionId, phase: "sending-prompt" },
      });

      if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const result = await client.prompt(sessionId, promptText);
      if (hooks?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const usedModel = extractModelFromPromptResult(result);

      if (live) {
        live.running = false;
        live.phase = "completed";
        live.currentAction = "gemini run completed";
        live.stopReason = result?.stopReason;
        if (usedModel) {
          live.model = usedModel;
          pushLiveEvent(`Model used: ${usedModel}`);
        }
        pushLiveEvent(`Prompt completed${result?.stopReason ? ` (${result.stopReason})` : ""}`);
      }

      state.sessions[sessionId] = { lastUsedAt: Date.now(), cwd: ctx.cwd, model: usedModel };
      persistState();

      const answer = live?.answer.trim() || "(no streamed text returned)";
      const thought = live?.thought.trim() || "";
      const model = state.sessions[sessionId]?.model;
      const events = live?.events ?? [];

      hooks?.onUpdate?.({
        content: [{ type: "text", text: answer }],
        details: { sessionId, phase: "completed", model, stopReason: result?.stopReason },
      });

      return {
        sessionId,
        prompt: promptText,
        answer,
        thought,
        events,
        model,
        stopReason: result?.stopReason,
      };
    } catch (err) {
      if (live) {
        live.running = false;
        pushLiveEvent(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      throw err;
    } finally {
      hooks?.signal?.removeEventListener("abort", onAbort);
      const lastSessionId = live?.sessionId;
      stopLiveTicker();
      publishUiState("idle", lastSessionId);
      live = null;
      liveCtx = null;
      updateUi(ctx);
    }
  };

  // ---------------------------------------------------------------------------
  // Slash-command run wrapper (sends Pi messages)
  // ---------------------------------------------------------------------------

  const executegeminiRun = async (opts: geminiRunOpts, ctx: any) => {
    if (ctx.isIdle && typeof ctx.isIdle === "function" && !ctx.isIdle()) {
      ctx.ui.notify("Pi is currently busy. Wait for current turn to finish.", "warning");
      return;
    }

    if (live?.running) {
      ctx.ui.notify("gemini is already running. Please wait or use /gemini:stop.", "warning");
      return;
    }

    const promptText = opts.prompt;
    if (!promptText && !opts.explicitResume) {
      ctx.ui.notify("Prompt cannot be empty", "error");
      return;
    }

    try {
      const runResult = await performgeminiRun(opts, ctx);

      // Resume-only (no prompt was sent)
      if (!promptText) {
        ctx.ui.notify(`Resumed gemini session ${runResult.sessionId}`, "success");
        return;
      }

      // Send visible display message (renderer builds the view from details)
      pi.sendMessage(
        {
          customType: "gemini-acp",
          content: "", // Renderer builds display from details
          display: true,
          details: {
            sessionId: runResult.sessionId,
            prompt: promptText,
            answer: runResult.answer,
            thought: runResult.thought,
            events: runResult.events,
            model: runResult.model,
            stopReason: runResult.stopReason,
            phase: "completed",
          },
        },
        { triggerTurn: false },
      );

      // Send hidden context message to steer the model
      const contextContent = `[gemini completed] gemini already executed this task${runResult.model ? ` (${runResult.model})` : ""}. Do NOT re-run it. Treat the gemini output below as background context only.\n\nYour next visible response must be brief and should NOT summarize, restate, analyze, or transform the gemini result. Instead, tell the user the gemini result is ready and ask what they want to do with it next.\n\nOriginal task:\n${promptText}\n\ngemini result:\n=== gemini output start ===\n${runResult.answer}\n=== gemini output end ===`;

      pi.sendMessage(
        {
          customType: "gemini-acp-context",
          content: contextContent,
          display: false,
        },
        { triggerTurn: true },
      );
    } catch (err) {
      ctx.ui.notify(
        `gemini error: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  };

  const runCustomCommandByName = async (name: string, rawArgs: string, ctx: any) => {
    const expanded = resolvegeminiCommand(name, rawArgs, ctx.cwd);
    if (!expanded) {
      ctx.ui.notify(
        `gemini command not found: ${name}\nLooked in .gemini/commands/ and ~/.gemini/commands/`,
        "error",
      );
      return;
    }

    ctx.ui.notify(`Resolved gemini command /${name} — sending expanded prompt via ACP`, "info");
    await executegeminiRun({ prompt: expanded }, ctx);
  };

  // ---------------------------------------------------------------------------
  // Colon-namespaced commands
  // ---------------------------------------------------------------------------

  pi.registerCommand("gemini", {
    description: "Run gemini via ACP with a prompt",
    async handler(args: string, ctx: any) {
      const raw = args.trim();
      if (!raw) {
        ctx.ui.notify(
          "Usage: /gemini <prompt>\nSee also: /gemini:new, /gemini:resume, /gemini:cmd, /gemini:stop, /gemini:status, /gemini:sessions",
          "info",
        );
        return;
      }

      await executegeminiRun({ prompt: raw }, ctx);
    },
  });

  pi.registerCommand("gemini:new", {
    description: "Start a new gemini session with a prompt",
    async handler(args: string, ctx: any) {
      const prompt = args.trim() || undefined;
      await executegeminiRun({ prompt, forceNewSession: true }, ctx);
    },
  });

  pi.registerCommand("gemini:resume", {
    description: "Resume an existing gemini session (/gemini:resume <sessionId> [prompt])",
    async handler(args: string, ctx: any) {
      const parts = args.trim().split(/\s+/);
      const sessionIdArg = parts[0];
      if (!sessionIdArg) {
        ctx.ui.notify("Usage: /gemini:resume <sessionId> [prompt]", "error");
        return;
      }
      const prompt = parts.slice(1).join(" ").trim() || undefined;
      await executegeminiRun(
        { prompt, explicitSessionId: sessionIdArg, explicitResume: true },
        ctx,
      );
    },
  });

  pi.registerCommand("gemini:stop", {
    description: "Cancel the current gemini run",
    async handler(_args: string, ctx: any) {
      await cancelLiveRun(ctx, "command");
    },
  });

  pi.registerCommand("gemini:status", {
    description: "Show gemini process/session status",
    async handler(_args: string, ctx: any) {
      showStatus();
    },
  });

  pi.registerCommand("gemini:sessions", {
    description: "List known gemini sessions",
    async handler(_args: string, ctx: any) {
      showSessions();
    },
  });

  pi.registerCommand("gemini:cmd", {
    description: "Run a custom gemini .toml command (/gemini:cmd <name> [args...])",
    async handler(args: string, ctx: any) {
      const parts = args.trim().split(/\s+/);
      const cmdName = parts[0];
      if (!cmdName) {
        ctx.ui.notify(
          "Usage: /gemini:cmd <command-name> [args...]\nResolves a custom gemini .toml command and runs it via ACP.",
          "info",
        );
        return;
      }
      await runCustomCommandByName(cmdName, parts.slice(1).join(" "), ctx);
    },
  });

  // ---------------------------------------------------------------------------
  // General ask_gemini tool is disabled by default.
  // Use /gemini slash command or dynamic ask_gemini_cmd_<name> tools instead.
  // To re-enable, set PI_ENABLE_ASK_GEMINI=1.

  // ---------------------------------------------------------------------------
  // Dynamic custom command discovery (slash commands + tools)
  // ---------------------------------------------------------------------------

  const registeredDynamicCommands = new Set<string>();
  const registeredDynamicTools = new Map<string, string>(); // toolName -> commandName

  /**
   * Normalize a gemini command name to a safe tool identifier.
   * E.g. "reviewer" -> "ask_gemini_cmd_reviewer", "git:commit" -> "ask_gemini_cmd_git_commit"
   */
  const commandNameToToolName = (cmdName: string): string => {
    return `ask_gemini_cmd_${cmdName.replace(/[:\-]/g, "_")}`;
  };

  const discoverAndRegisterCustomCommands = (cwd: string) => {
    // Clear stale registrations to handle CWD changes and deleted .toml files.
    // pi.registerCommand / pi.registerTool will overwrite with fresh definitions.
    registeredDynamicCommands.clear();
    registeredDynamicTools.clear();
    const names = discovergeminiCommandNames(cwd);
    for (const name of names) {
      // Register slash command
      const commandName = `gemini:cmd:${name}`;
      if (!registeredDynamicCommands.has(commandName)) {
        registeredDynamicCommands.add(commandName);
        pi.registerCommand(commandName, {
          description: `Run custom gemini command "${name}"`,
          async handler(args: string, ctx: any) {
            await runCustomCommandByName(name, args.trim(), ctx);
          },
        });
      }

      // Register dynamic tool
      const toolName = commandNameToToolName(name);
      if (!registeredDynamicTools.has(toolName)) {
        registeredDynamicTools.set(toolName, name);

        // Read command description for richer tool description
        const commandDescription = (() => {
          const candidates = buildCommandPaths(name, cwd);
          for (const filePath of candidates) {
            if (!existsSync(filePath)) continue;
            try {
              const raw = readFileSync(filePath, "utf8");
              const match = raw.match(/^\s*description\s*=\s*["'](.+?)["']/m);
              return match?.[1];
            } catch {
              /* skip */
            }
          }
          return undefined;
        })();

        // Capture command name for closure
        const capturedName = name;
        const capturedDesc = commandDescription;
        const toolDesc =
          `Run the "${capturedName}" gemini custom command via ACP.\n` +
          (capturedDesc ? `${capturedDesc}\n` : "") +
          "Use when the user asks gemini to perform this specific command.\n" +
          "Pass user arguments via the 'args' parameter.";

        pi.registerTool({
          name: toolName,
          label: `gemini: ${name}`,
          description: toolDesc,
          parameters: dynamicGeminiCmdParams,

          async execute(
            _toolCallId: string,
            rawParams: unknown,
            signal: AbortSignal | undefined,
            onUpdate: AgentToolUpdateCallback<geminiToolDetails> | undefined,
            ctx: ExtensionContext,
          ): Promise<AgentToolResult<geminiToolDetails>> {
            const params = rawParams as dynamicGeminiCmdParamsType;

            const expanded = resolvegeminiCommand(capturedName, params.args || "", ctx.cwd);
            if (!expanded) {
              throw new Error(`gemini command not found: ${capturedName}`);
            }

            if (live?.running) {
              throw new Error("gemini is already running.");
            }

            const result = await performgeminiRun({ prompt: expanded }, ctx, {
              onUpdate,
              signal,
            });

            // Send visible display message (renderer builds the view from details)
            pi.sendMessage(
              {
                customType: "gemini-acp",
                content: "", // Renderer builds display from details
                display: true,
                details: {
                  sessionId: result.sessionId,
                  prompt: result.prompt,
                  answer: result.answer,
                  thought: result.thought,
                  events: result.events,
                  model: result.model,
                  stopReason: result.stopReason,
                  phase: "completed",
                  commandName: capturedName,
                },
              },
              { triggerTurn: false },
            );

            return {
              content: [{ type: "text", text: result.answer }],
              details: {
                sessionId: result.sessionId,
                model: result.model,
                stopReason: result.stopReason,
                commandName: capturedName,
                prompt: result.prompt,
              },
            };
          },
        });
      }
    }
  };

  // Re-discover on session start so new .toml files are picked up.
  pi.on("session_start", async (_event, ctx) => {
    discoverAndRegisterCustomCommands(ctx.cwd);
  });
}
