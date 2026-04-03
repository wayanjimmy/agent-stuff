/**
 * Gemini ACP Extension
 *
 * Slash command:
 *   /gemini <prompt>
 *   /gemini new <prompt>
 *   /gemini resume <sessionId> [prompt]
 *   /gemini stop
 *   /gemini status
 *   /gemini sessions
 *
 * What it does:
 * - Spawns `gemini --acp` as a background subprocess
 * - Talks JSON-RPC 2.0 over NDJSON (stdio)
 * - Streams progress to Pi UI (status + widget)
 * - Persists session mapping via pi.appendEntry()
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

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
  yoloPermissions?: boolean;
  sessions: Record<string, { lastUsedAt: number; cwd: string; model?: string }>;
};

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

class AcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private ready = false;
  private initialized = false;
  private yoloPermissions = true;
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

  setYoloPermissions(enabled: boolean): void {
    this.yoloPermissions = enabled;
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
      this.proc.kill("SIGTERM");
    }
    this.teardown(new Error("Gemini ACP process stopped"));
  }

  getStderrTail(): string {
    return this.stderrBuffer.slice(-1500);
  }

  private spawnProcess(cwd: string): void {
    const bin = process.env.GEMINI_BIN || "gemini";
    const args = ["--acp"];

    const proc = spawn(bin, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
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
      if (!this.yoloPermissions) {
        this.writeResponse(request.id, { outcome: "cancelled" });
        return;
      }

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
  const state: GeminiState = { sessions: {}, yoloPermissions: true };
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
    const data = entry.data as GeminiState | undefined;
    if (data && typeof data === "object") {
      state.currentSessionId = data.currentSessionId;
      state.sessions = data.sessions || {};
      state.yoloPermissions = data.yoloPermissions ?? true;
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

    const elapsed = Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000));
    const answerPreview = (live.answer || "").replace(/\s+/g, " ").trim();
    const thoughtPreview = (live.thought || "").replace(/\s+/g, " ").trim();
    const events = trimLines(live.events, 3);

    const loadingFrames = getLoadingFrames();
    const spinner = loadingFrames[Math.floor(Date.now() / 120) % loadingFrames.length];

    const phaseLabel =
      live.phase === "running" ? `${spinner} running` : live.phase === "error" ? "✗ error" : "✓ completed";

    const status =
      live.phase === "running"
        ? `${spinner} Gemini ACP running • ${elapsed}s • session ${live.sessionId}`
        : live.phase === "error"
          ? `✗ Gemini ACP error • ${elapsed}s • session ${live.sessionId}`
          : `✓ Gemini ACP done • ${elapsed}s • session ${live.sessionId}`;

    const clip = (s: string, max = 72) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

    const body = [
      `Gemini ACP [${phaseLabel}] ${elapsed}s`,
      `Session: ${clip(live.sessionId, 54)}`,
      `Prompt: ${clip(live.prompt || "", 72)}`,
      `Answer: ${clip(answerPreview || "(waiting for model output)", 72)}`,
    ];

    if (thoughtPreview) {
      body.push(`Thinking: ${clip(thoughtPreview, 72)}`);
    }

    if (live.error) {
      body.push(`Error: ${clip(live.error, 72)}`);
    }

    if (events.length) {
      body.push(`Events: ${events.map((e) => clip(e, 22)).join(" | ")}`);
    }

    const boxed: string[] = [];
    const width = Math.max(44, Math.min(90, Math.max(...body.map((l) => l.length)) + 2));
    boxed.push(`┌${"─".repeat(width)}┐`);
    for (const line of body) {
      const clipped = line.length > width ? `${line.slice(0, width - 1)}…` : line;
      boxed.push(`│${clipped}${" ".repeat(Math.max(0, width - clipped.length))}│`);
    }
    boxed.push(`└${"─".repeat(width)}┘`);

    ctx.ui.setStatus(EXT_STATUS_KEY, status);
    ctx.ui.setWidget(EXT_WIDGET_KEY, boxed);
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
          live.events.push("thinking: model reasoning stream started");
        }
      }
    } else if (updateType === "tool_call") {
      const title = update?.toolCall?.title || update?.title || update?.toolName || "tool call";
      live.events.push(`tool_call: ${title}`);
    } else if (updateType === "tool_call_update") {
      const status = update?.toolCall?.status || update?.status || "updated";
      live.events.push(`tool_call_update: ${status}`);
    } else if (updateType === "available_commands_update") {
      live.events.push("commands updated");
    } else if (method === "requestPermission") {
      live.events.push("permission requested -> auto-approved (YOLO)");
    } else if (updateType && updateType !== "session/update") {
      live.events.push(`update: ${updateType}`);
    }

    if (liveCtx) updateUi(liveCtx);
  });

  pi.on("session_start", async (_event, ctx) => {
    state = restoreState(ctx);
    client.setYoloPermissions(state.yoloPermissions ?? true);
    ctx.ui.setStatus(EXT_STATUS_KEY, "Gemini ACP idle");
    ctx.ui.setWidget(EXT_WIDGET_KEY, []);
  });

  pi.on("session_shutdown", async () => {
    stopLiveTicker();
    unsubscribeNotifications();
    client.stop();
  });

  pi.registerCommand("gemini", {
    description:
      "Run Gemini via ACP (/gemini <prompt> | new <prompt> | resume <sessionId> [prompt] | stop | status | sessions | yolo on|off)",
    async handler(args: string, ctx: any) {
      const raw = args.trim();
      if (!raw) {
        ctx.ui.notify(
          "Usage: /gemini <prompt> | /gemini new <prompt> | /gemini resume <sessionId> [prompt] | /gemini stop | /gemini status | /gemini sessions | /gemini yolo on|off",
          "info",
        );
        return;
      }

      const [sub, ...rest] = raw.split(/\s+/);

      if (sub === "stop") {
        if (live?.running) {
          await client.cancel(live.sessionId);
          live.running = false;
          live.events.push("cancel requested");
          updateUi(ctx);
          ctx.ui.notify("Sent cancel to Gemini ACP", "warning");
        } else {
          ctx.ui.notify("No Gemini run in progress", "info");
        }
        return;
      }

      if (sub === "status") {
        const status = [
          `process: ${client.isRunning() ? "running" : "stopped"}`,
          `current session: ${state.currentSessionId ?? "(none)"}`,
          `permissions: ${state.yoloPermissions ? "YOLO auto-approve" : "deny-by-default"}`,
          `known sessions: ${Object.keys(state.sessions).length}`,
          live ? `active run: ${live.running ? "running" : "done"}` : "active run: none",
        ].join("\n");

        const stderr = client.getStderrTail();
        pi.sendMessage(
          {
            customType: "gemini-acp",
            content: `### Gemini ACP Status\n\n${status}${stderr ? `\n\n### stderr (tail)\n\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
            display: "all",
          },
          { triggerTurn: false },
        );
        return;
      }

      if (sub === "yolo") {
        const mode = (rest[0] || "").toLowerCase();
        if (!mode) {
          ctx.ui.notify(
            `YOLO is currently ${state.yoloPermissions ? "on" : "off"}. Use /gemini yolo on|off`,
            "info",
          );
          return;
        }

        if (mode !== "on" && mode !== "off") {
          ctx.ui.notify("Usage: /gemini yolo on|off", "error");
          return;
        }

        state.yoloPermissions = mode === "on";
        client.setYoloPermissions(state.yoloPermissions);
        persistState();
        ctx.ui.notify(
          state.yoloPermissions
            ? "Gemini ACP permissions set to YOLO auto-approve"
            : "Gemini ACP permissions set to deny-by-default",
          state.yoloPermissions ? "success" : "warning",
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
            display: "all",
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

      let mode: "default" | "new" | "resume" = "default";
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
          thought: "",
          thoughtStarted: false,
          events: ["starting gemini acp..."],
          running: true,
          phase: "running",
        };
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
          live.events.push("session ready");
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
          live.events.push("prompt sent");
        }
        publishUiState("waiting", sessionId);
        updateUi(ctx);

        const result = await client.prompt(sessionId, promptText);
        const usedModel = extractModelFromPromptResult(result);

        live.running = false;
        live.phase = "completed";
        if (usedModel) {
          live.events.push(`model: ${usedModel}`);
        }
        live.events.push(`prompt completed${result?.stopReason ? ` (${result.stopReason})` : ""}`);
        state.sessions[sessionId] = { lastUsedAt: Date.now(), cwd: ctx.cwd, model: usedModel };
        persistState();
        stopLiveTicker();
        publishUiState("idle", sessionId);
        updateUi(ctx);

        const answer = live.answer.trim() || "(no streamed text returned)";
        const thought = live.thought.trim();

        let content = `### Gemini (${sessionId})\n\n**Prompt**\n\n${promptText}\n\n**Answer**\n\n${answer}`;
        if (thought) {
          content += `\n\n<details><summary>Thought stream</summary>\n\n${thought}\n\n</details>`;
        }

        pi.sendMessage(
          {
            customType: "gemini-acp",
            content,
            display: "all",
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
          live.events.push(`error: ${live.error}`);
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
    },
  });
}
