/**
 * Gemini ACP Extension
 *
 * Slash command:
 *   /gemini <prompt>
 *   /gemini:new [prompt]
 *   /gemini:resume <sessionId> [prompt]
 *   /gemini:stop
 *   /gemini:status
 *   /gemini:sessions
 *   /gemini:cmd:reviewer [prompt]
 *
 * What it does:
 * - Spawns `gemini --acp` as a background subprocess
 * - Talks JSON-RPC 2.0 over NDJSON (stdio)
 * - Streams progress to Pi UI (status + widget)
 * - Shows a Gemini result card and stores only the raw Gemini answer as hidden context for later Pi turns
 * - Persists session mapping via pi.appendEntry()
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text, truncateToWidth } from "@mariozechner/pi-tui";

const EXT_STATUS_KEY = "gemini-acp";
const EXT_WIDGET_KEY = "gemini-acp";
const STATE_ENTRY_TYPE = "gemini-acp-state";
const DEFAULT_TIMEOUT_MS = 120_000;
const PROMPT_TIMEOUT_MS = 15 * 60_000;
const COMMANDS = {
  root: "gemini",
  new: "gemini:new",
  resume: "gemini:resume",
  stop: "gemini:stop",
  status: "gemini:status",
  sessions: "gemini:sessions",
  presetPrefix: "gemini:cmd",
} as const;

const PROMPT_PRESETS = {
  reviewer: {
    description: "Run Gemini with a code reviewer prompt preset",
    buildPrompt(args: string) {
      const extra = args.trim();
      return [
        "You are a thorough code reviewer. Focus on:",
        "- Correctness and potential bugs",
        "- Security vulnerabilities",
        "- Edge cases and error handling",
        "- Actionable, concrete feedback",
        extra ? `Additional context:\n${extra}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
} as const;

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

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
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

type RunMode = "current" | "new" | "resume";

type RunGeminiOptions = {
  mode: RunMode;
  promptText?: string;
  sessionId?: string;
};

type LegacyGeminiAction =
  | { kind: "status"; replacement: string }
  | { kind: "sessions"; replacement: string }
  | { kind: "stop"; replacement: string }
  | { kind: "new"; replacement: string; promptText?: string }
  | { kind: "resume"; replacement: string; sessionId?: string; promptText?: string };

type LiveRun = {
  sessionId: string;
  startedAt: number;
  prompt: string;
  answer: string;
  thought: string;
  thoughtStarted: boolean;
  events: string[];
  running: boolean;
  phase: "running" | "completed" | "error";
  error?: string;
};

type PermissionOption = { optionId?: string; id?: string; name?: string; title?: string; label?: string };
type GeminiLaunchSpec = { command: string; args: string[] };

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

  constructor(private readonly pi: ExtensionAPI) {}

  onNotification(handler: (method: string, params: any) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  isRunning(): boolean {
    return !!this.proc && !this.proc.killed;
  }

  async ensureReady(cwd: string): Promise<void> {
    if (!this.proc || this.proc.killed) {
      this.spawnProcess(cwd);
    }
    if (this.ready) return;

    await this.initialize();
    await this.authenticateIfConfigured();
    this.ready = true;
  }

  async ensureSession(cwd: string, sessionId?: string, options?: { explicitResume?: boolean }): Promise<string> {
    await this.ensureReady(cwd);

    if (sessionId) {
      if (!this.loadedSessions.has(sessionId)) {
        try {
          await this.request("session/load", { sessionId, cwd, mcpServers: [] }, DEFAULT_TIMEOUT_MS);
          this.loadedSessions.add(sessionId);
          return sessionId;
        } catch (err) {
          if (options?.explicitResume) {
            throw new Error(
              `Failed to resume session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          // Automatic resume path: fall through to creating a new session.
        }
      } else {
        return sessionId;
      }
    }

    const created = (await this.request("session/new", { cwd, mcpServers: [] }, DEFAULT_TIMEOUT_MS)) as {
      sessionId?: string;
    };
    if (!created?.sessionId) {
      throw new Error("ACP newSession did not return a sessionId");
    }
    this.loadedSessions.add(created.sessionId);
    return created.sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason?: string; _meta?: any }> {
    const result = (await this.request(
      "session/prompt",
      {
        sessionId,
        prompt: [{ type: "text", text }],
      },
      PROMPT_TIMEOUT_MS,
    )) as { stopReason?: string; _meta?: any };
    return result ?? {};
  }

  async cancel(sessionId: string): Promise<void> {
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

  private spawnProcess(cwd: string): void {
    const bin = process.env.GEMINI_BIN || "gemini";
    const launch = getGeminiLaunchSpec(bin);

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
      const result = selectedOptionId
        ? { outcome: "selected", optionId: selectedOptionId }
        : { outcome: "selected" };
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
    if (value.content && Array.isArray(value.content)) return extractText(value.content);
  }
  return "";
}

function trimLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  return lines.slice(lines.length - max);
}

function oneLinePreview(value: string | undefined, fallback = ""): string {
  const compact = (value || "").replace(/\s+/g, " ").trim();
  return compact || fallback;
}

function getGeminiUsage(): string {
  return [
    `/${COMMANDS.root} <prompt>`,
    `/${COMMANDS.new} [prompt]`,
    `/${COMMANDS.resume} <sessionId> [prompt]`,
    `/${COMMANDS.stop}`,
    `/${COMMANDS.status}`,
    `/${COMMANDS.sessions}`,
    `/${COMMANDS.presetPrefix}:reviewer [prompt]`,
  ].join(" | ");
}

function parseResumeArgs(args: string): { sessionId?: string; promptText?: string } {
  const trimmed = args.trim();
  if (!trimmed) return {};
  const [sessionId, ...rest] = trimmed.split(/\s+/);
  return {
    sessionId,
    promptText: rest.join(" ").trim() || undefined,
  };
}

function parseLegacyGeminiAction(raw: string): LegacyGeminiAction | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "status") return { kind: "status", replacement: COMMANDS.status };
  if (trimmed === "sessions") return { kind: "sessions", replacement: COMMANDS.sessions };
  if (trimmed === "stop") return { kind: "stop", replacement: COMMANDS.stop };
  if (trimmed === "new") return { kind: "new", replacement: COMMANDS.new };
  if (trimmed.startsWith("new ")) {
    return { kind: "new", replacement: COMMANDS.new, promptText: trimmed.slice(4).trim() || undefined };
  }
  if (trimmed === "resume") return { kind: "resume", replacement: COMMANDS.resume };
  if (trimmed.startsWith("resume ")) {
    const parsed = parseResumeArgs(trimmed.slice(7));
    return {
      kind: "resume",
      replacement: COMMANDS.resume,
      sessionId: parsed.sessionId,
      promptText: parsed.promptText,
    };
  }
  return null;
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

  return scored[0]?.id;
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
    };

    if (!details.sessionId) {
      return new Text(String(message.content || ""), 0, 0);
    }

    const header = theme.fg("accent", `Gemini ACP · ${details.sessionId}`);
    const model = details.model ? `\n${theme.bold("Model:")} ${details.model}` : "";
    const prompt = details.prompt ? `\n${theme.bold("Prompt:")} ${details.prompt}` : "";
    const answer = details.answer ? `\n\n${theme.bold("Answer:")}\n${details.answer}` : "";

    let timeline = "";
    if (Array.isArray(details.events) && details.events.length) {
      const visible = expanded ? details.events : details.events.slice(-6);
      timeline = `\n\n${theme.bold("Timeline:")}\n${visible.map((e) => `• ${e}`).join("\n")}`;
      if (!expanded && details.events.length > visible.length) {
        timeline += `\n${theme.fg("dim", `… ${details.events.length - visible.length} more (expand to view all)`)}`;
      }
    }

    const thought = details.thought
      ? `\n\n${theme.bold("Thought stream:")}\n${expanded ? details.thought : `${details.thought.slice(0, 600)}${details.thought.length > 600 ? "…" : ""}`}`
      : "";

    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(`${header}${model}${prompt}${answer}${timeline}${thought}`, 0, 0));
    return box;
  });

  const persistState = () => {
    pi.appendEntry(STATE_ENTRY_TYPE, state);
  };

  const updateUi = (ctx: any) => {
    if (!ctx) return;
    if (!live) {
      ctx.ui.setStatus(EXT_STATUS_KEY, "");
      ctx.ui.setWidget(EXT_WIDGET_KEY, []);
      return;
    }

    const liveRun = live;
    const elapsed = formatElapsed(Date.now() - liveRun.startedAt);
    const answerPreview = oneLinePreview(liveRun.answer);
    const thoughtPreview = oneLinePreview(liveRun.thought);
    const promptPreview = oneLinePreview(liveRun.prompt, "(no prompt)");
    const events = trimLines(liveRun.events, 4);

    const loadingFrames = getLoadingFrames();
    const spinner = loadingFrames[Math.floor(Date.now() / 120) % loadingFrames.length];
    const shortSessionId =
      liveRun.sessionId.length > 16
        ? `${liveRun.sessionId.slice(0, 8)}…${liveRun.sessionId.slice(-4)}`
        : liveRun.sessionId;

    const stage =
      liveRun.phase === "error"
        ? "error"
        : liveRun.phase === "completed"
          ? "completed"
          : answerPreview
            ? "streaming answer"
            : thoughtPreview
              ? "thinking"
              : liveRun.events.some((event) => event.toLowerCase().includes("prompt sent"))
                ? "waiting for response"
                : liveRun.events.some((event) => event.toLowerCase().includes("session ready"))
                  ? "sending prompt"
                  : "starting";

    const action = oneLinePreview(events[events.length - 1], "Waiting for Gemini response");

    const status =
      liveRun.phase === "running"
        ? `${spinner} Gemini ACP • ${stage} • ${elapsed} • ${shortSessionId}`
        : liveRun.phase === "error"
          ? `✗ Gemini ACP • error • ${elapsed} • ${shortSessionId}`
          : `✓ Gemini ACP • done • ${elapsed} • ${shortSessionId}`;

    ctx.ui.setStatus(EXT_STATUS_KEY, status);
    ctx.ui.setWidget(EXT_WIDGET_KEY, () => ({
      invalidate() {},
      render(width: number): string[] {
        const lines = [
          `Gemini ACP · ${liveRun.sessionId}`,
          `Status: ${liveRun.phase === "running" ? `${spinner} ${stage}` : liveRun.phase} • ${elapsed}`,
          `Action: ${action}`,
          `Prompt: ${promptPreview}`,
        ];

        if (liveRun.error) {
          lines.push(`Error: ${oneLinePreview(liveRun.error)}`);
        } else if (answerPreview) {
          lines.push(`Answer: ${answerPreview}`);
        } else if (thoughtPreview) {
          lines.push(`Thinking: ${thoughtPreview}`);
        } else {
          lines.push("Answer: (waiting for model output)");
        }

        if (events.length) {
          lines.push("Recent:");
          for (const event of events.slice().reverse()) {
            lines.push(`- ${oneLinePreview(event)}`);
          }
        }

        return lines.map((line) => truncateToWidth(line, Math.max(0, width)));
      },
    }));
  };

  const startLiveTicker = () => {
    if (liveTicker) clearInterval(liveTicker);
    liveTicker = setInterval(() => {
      if (live && liveCtx) updateUi(liveCtx);
    }, 150);
  };

  const stopLiveTicker = () => {
    if (liveTicker) {
      clearInterval(liveTicker);
      liveTicker = null;
    }
  };

  const unsubscribeNotifications = client.onNotification((method, params) => {
    if (!live) return;

    const p = params ?? {};
    const sid = p.sessionId;
    if (sid && sid !== live.sessionId) return;

    const update = p.update ?? p;
    const updateType = update?.sessionUpdate || update?.type || method;

    if (updateType === "agent_message_chunk") {
      const chunk = extractText(update?.content ?? update);
      if (chunk) {
        live.answer += chunk;
        publishUiState("streaming", live.sessionId);
      }
    } else if (updateType === "agent_thought_chunk" || String(updateType).includes("thought")) {
      publishUiState("streaming", live.sessionId);
      const chunk = extractText(update?.content ?? update);
      if (chunk) {
        live.thought += chunk;
        if (!live.thoughtStarted) {
          live.thoughtStarted = true;
          live.events.push("Thinking started");
        }
      }
    } else if (updateType === "tool_call") {
      const title = update?.toolCall?.title || update?.title || update?.toolName || "tool call";
      live.events.push(`Tool call: ${title}`);
    } else if (updateType === "tool_call_update") {
      const status = update?.toolCall?.status || update?.status || "updated";
      live.events.push(`Tool update: ${status}`);
    } else if (updateType === "available_commands_update") {
      live.events.push("Commands updated");
    } else if (method === "requestPermission") {
      live.events.push("Permission requested; auto-approved");
    } else if (updateType && updateType !== "session/update") {
      live.events.push(`Update: ${updateType}`);
    }

    if (liveCtx) updateUi(liveCtx);
  });

  pi.on("session_start", async (_event, ctx) => {
    state = restoreState(ctx);
    ctx.ui.setStatus(EXT_STATUS_KEY, "Gemini ACP idle");
    ctx.ui.setWidget(EXT_WIDGET_KEY, []);
  });

  pi.on("session_shutdown", async () => {
    stopLiveTicker();
    unsubscribeNotifications();
    client.stop();
  });

  const ensureRunAvailable = (ctx: any): boolean => {
    if (ctx.isIdle && typeof ctx.isIdle === "function" && !ctx.isIdle()) {
      ctx.ui.notify("Pi is currently busy. Wait for current turn to finish.", "warning");
      return false;
    }

    if (live?.running) {
      ctx.ui.notify(`Gemini ACP is already running. Please wait or use /${COMMANDS.stop}.`, "warning");
      return false;
    }

    return true;
  };

  const showGeminiStatus = () => {
    const status = [
      `process: ${client.isRunning() ? "running" : "stopped"}`,
      `current session: ${state.currentSessionId ?? "(none)"}`,
      `known sessions: ${Object.keys(state.sessions).length}`,
      live ? `active run: ${live.running ? "running" : "done"}` : "active run: none",
    ].join("\n");

    const stderr = client.getStderrTail();
    pi.sendMessage(
      {
        customType: "gemini-acp",
        content: `### Gemini ACP Status\n\n${status}${stderr ? `\n\n### stderr (tail)\n\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
        display: true,
      },
      { triggerTurn: false },
    );
  };

  const showGeminiSessions = () => {
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
  };

  const stopGeminiRun = async (ctx: any) => {
    if (live?.running) {
      await client.cancel(live.sessionId);
      live.running = false;
      live.events.push("Cancel requested");
      updateUi(ctx);
      ctx.ui.notify("Sent cancel to Gemini ACP", "warning");
      return;
    }

    ctx.ui.notify("No Gemini run in progress", "info");
  };

  const runGeminiPrompt = async (ctx: any, options: RunGeminiOptions) => {
    const promptText = options.promptText?.trim() || undefined;

    if (options.mode === "current" && !promptText) {
      ctx.ui.notify("Prompt cannot be empty", "error");
      return;
    }

    if (options.mode === "resume" && !options.sessionId) {
      ctx.ui.notify(`Usage: /${COMMANDS.resume} <sessionId> [prompt]`, "error");
      return;
    }

    if (!ensureRunAvailable(ctx)) return;

    try {
      // Optimistic UI: show activity immediately so Enter doesn't feel frozen.
      liveCtx = ctx;
      live = {
        sessionId: options.sessionId || state.currentSessionId || "(starting)",
        startedAt: Date.now(),
        prompt: promptText || "(no prompt)",
        answer: "",
        thought: "",
        thoughtStarted: false,
        events: ["Starting Gemini ACP"],
        running: true,
        phase: "running",
      };
      startLiveTicker();
      publishUiState("waiting", live.sessionId);
      updateUi(ctx);

      let sessionId: string;

      if (options.mode === "new") {
        sessionId = await client.ensureSession(ctx.cwd);
      } else if (options.mode === "resume") {
        sessionId = await client.ensureSession(ctx.cwd, options.sessionId, { explicitResume: true });
      } else {
        sessionId = await client.ensureSession(ctx.cwd, state.currentSessionId);
      }

      state.currentSessionId = sessionId;
      state.sessions[sessionId] = { lastUsedAt: Date.now(), cwd: ctx.cwd };
      persistState();

      if (live) {
        live.sessionId = sessionId;
        live.events.push("Session ready");
      }

      if (!promptText) {
        stopLiveTicker();
        publishUiState("idle", sessionId);
        live = null;
        liveCtx = null;
        updateUi(ctx);
        const notice = options.mode === "new" ? "Started" : "Resumed";
        ctx.ui.notify(`${notice} Gemini session ${sessionId}`, "success");
        return;
      }

      if (live) {
        live.events.push("Prompt sent");
      }
      publishUiState("waiting", sessionId);
      updateUi(ctx);

      const result = await client.prompt(sessionId, promptText);
      const usedModel = extractModelFromPromptResult(result);

      live.running = false;
      live.phase = "completed";
      if (usedModel) {
        live.events.push(`Model: ${usedModel}`);
      }
      live.events.push(`Prompt completed${result?.stopReason ? ` (${result.stopReason})` : ""}`);
      state.sessions[sessionId] = { lastUsedAt: Date.now(), cwd: ctx.cwd, model: usedModel };
      persistState();
      stopLiveTicker();
      publishUiState("idle", sessionId);
      updateUi(ctx);

      const answerText = live.answer.trim();
      const answer = answerText || "(no streamed text returned)";
      const thought = live.thought.trim();

      // Build content for LLM context with clear attribution.
      // The custom renderer uses `details` for display, so this prefixed
      // content won't be shown to the user directly.
      const llmContent = answerText
        ? `[Gemini was asked: "${promptText}"]\n\nGemini's answer:\n${answerText}`
        : "(no streamed text returned)";

      pi.sendMessage(
        {
          customType: "gemini-acp",
          content: llmContent,
          display: true,
          details: {
            sessionId,
            prompt: promptText,
            answer,
            thought,
            events: live.events,
            model: state.sessions[sessionId]?.model,
          },
        },
        { triggerTurn: false },
      );
    } catch (err) {
      if (live) {
        live.running = false;
        live.phase = "error";
        live.error = err instanceof Error ? err.message : String(err);
        live.events.push(`Error: ${live.error}`);
        stopLiveTicker();
        updateUi(ctx);
      }
      ctx.ui.notify(`Gemini ACP error: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      stopLiveTicker();
      publishUiState("idle", live?.sessionId);
      live = null;
      liveCtx = null;
      updateUi(ctx);
    }
  };

  pi.registerCommand(COMMANDS.root, {
    description: `Send a prompt to Gemini ACP or use legacy aliases like /${COMMANDS.root} status`,
    async handler(args: string, ctx: any) {
      const raw = args.trim();
      if (!raw) {
        ctx.ui.notify(`Usage: ${getGeminiUsage()}`, "info");
        return;
      }

      const legacyAction = parseLegacyGeminiAction(raw);
      if (!legacyAction) {
        await runGeminiPrompt(ctx, { mode: "current", promptText: raw });
        return;
      }

      ctx.ui.notify(`Deprecated: use /${legacyAction.replacement}`, "info");

      if (legacyAction.kind === "status") {
        showGeminiStatus();
        return;
      }

      if (legacyAction.kind === "sessions") {
        showGeminiSessions();
        return;
      }

      if (legacyAction.kind === "stop") {
        await stopGeminiRun(ctx);
        return;
      }

      if (legacyAction.kind === "new") {
        await runGeminiPrompt(ctx, { mode: "new", promptText: legacyAction.promptText });
        return;
      }

      await runGeminiPrompt(ctx, {
        mode: "resume",
        sessionId: legacyAction.sessionId,
        promptText: legacyAction.promptText,
      });
    },
  });

  pi.registerCommand(COMMANDS.new, {
    description: "Start a new Gemini ACP session and optionally send a prompt",
    async handler(args: string, ctx: any) {
      await runGeminiPrompt(ctx, { mode: "new", promptText: args });
    },
  });

  pi.registerCommand(COMMANDS.resume, {
    description: "Resume a Gemini ACP session and optionally send a prompt",
    async handler(args: string, ctx: any) {
      const parsed = parseResumeArgs(args);
      await runGeminiPrompt(ctx, {
        mode: "resume",
        sessionId: parsed.sessionId,
        promptText: parsed.promptText,
      });
    },
  });

  pi.registerCommand(COMMANDS.stop, {
    description: "Cancel the active Gemini ACP run",
    async handler(_args: string, ctx: any) {
      await stopGeminiRun(ctx);
    },
  });

  pi.registerCommand(COMMANDS.status, {
    description: "Show Gemini ACP process and session status",
    async handler() {
      showGeminiStatus();
    },
  });

  pi.registerCommand(COMMANDS.sessions, {
    description: "List known Gemini ACP sessions",
    async handler() {
      showGeminiSessions();
    },
  });

  for (const [name, preset] of Object.entries(PROMPT_PRESETS)) {
    pi.registerCommand(`${COMMANDS.presetPrefix}:${name}`, {
      description: preset.description,
      async handler(args: string, ctx: any) {
        await runGeminiPrompt(ctx, {
          mode: "current",
          promptText: preset.buildPrompt(args),
        });
      },
    });
  }
}
