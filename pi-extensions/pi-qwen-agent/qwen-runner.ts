import { spawn, type ChildProcess } from "node:child_process";

import { QwenStreamParser, type QwenEvent, type ToolUseInfo } from "./qwen-stream-parser.ts";

export type QwenStatus = "running" | "done" | "error" | "aborted";

export interface QwenRunState {
  status: QwenStatus;
  sessionId?: string;
  lastAssistantMessage: string;
  toolCalls: QwenToolCall[];
  stderrTail: string[];
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  startedAt: number;
  endedAt?: number;
}

export interface QwenToolCall {
  id: string;
  name: string;
  input: unknown;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
}

const MAX_TOOL_CALLS = 80;
const MAX_STDERR_LINES = 20;
const THROTTLE_MS = 150;

export interface QwenRunnerOptions {
  task: string;
  cwd?: string;
  approvalMode?: string;
  model?: string;
  includeDirectories?: string[];
  continueSession?: boolean;
  resume?: string;
  signal?: AbortSignal;
  onUpdate?: (state: QwenRunState) => void;
}

export async function runQwenAgent(options: QwenRunnerOptions): Promise<QwenRunState> {
  const {
    task,
    cwd,
    approvalMode,
    model,
    includeDirectories,
    continueSession,
    resume,
    signal,
    onUpdate,
  } = options;

  const args = buildArgs(task, {
    approvalMode,
    model,
    includeDirectories,
    continueSession,
    resume,
  });

  const state: QwenRunState = {
    status: "running",
    lastAssistantMessage: "",
    toolCalls: [],
    stderrTail: [],
    startedAt: Date.now(),
  };

  if (signal?.aborted) {
    state.status = "aborted";
    state.endedAt = Date.now();
    return state;
  }

  const proc = spawn("qwen", args, {
    cwd: cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const parser = new QwenStreamParser();
  let stderrBuffer = "";
  let lastUpdateTime = 0;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;

  const throttledUpdate = () => {
    const now = Date.now();
    if (now - lastUpdateTime < THROTTLE_MS) {
      if (!updateTimer) {
        updateTimer = setTimeout(
          () => {
            updateTimer = null;
            lastUpdateTime = Date.now();
            onUpdate?.({ ...state });
          },
          THROTTLE_MS - (now - lastUpdateTime),
        );
      }
      return;
    }
    lastUpdateTime = now;
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    onUpdate?.({ ...state });
  };

  const handleEvents = (events: QwenEvent[]) => {
    for (const event of events) {
      switch (event.kind) {
        case "system": {
          const sid =
            typeof event.data.session_id === "string"
              ? event.data.session_id
              : typeof event.data.thread_id === "string"
                ? event.data.thread_id
                : undefined;
          if (sid) state.sessionId = sid;
          break;
        }

        case "assistant_delta":
          state.lastAssistantMessage = event.text;
          break;

        case "assistant_message":
          if (event.text) {
            state.lastAssistantMessage = event.text;
          }
          if (event.toolUse) {
            for (const tu of event.toolUse) {
              addToolCall(state, tu);
            }
          }
          break;

        case "tool_result": {
          const call = state.toolCalls.find((c) => c.id === event.toolUseId);
          if (call) {
            call.endedAt = Date.now();
            call.isError = event.isError;
          }
          break;
        }

        case "result":
          if (event.text) state.lastAssistantMessage = event.text;
          if (event.usage) state.usage = event.usage;
          break;

        case "error":
          state.error = event.message;
          break;

        case "raw_text":
          break;
      }
    }
    throttledUpdate();
  };

  return new Promise<QwenRunState>((resolve) => {
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const killProc = () => {
      if (proc.exitCode !== null) return;
      proc.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }, 2000);
    };

    const onAbort = () => {
      state.status = "aborted";
      state.endedAt = Date.now();
      killProc();
      onUpdate?.({ ...state });
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.stdout!.on("data", (chunk: Buffer) => {
      const events = parser.feed(chunk.toString("utf-8"));
      handleEvents(events);
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf-8");
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      const complete = lines.filter(Boolean);
      if (complete.length > 0) {
        state.stderrTail.push(...complete);
        if (state.stderrTail.length > MAX_STDERR_LINES) {
          state.stderrTail.splice(0, state.stderrTail.length - MAX_STDERR_LINES);
        }
        throttledUpdate();
      }
    });

    proc.on("close", (code) => {
      const remaining = parser.flush();
      if (remaining.length > 0) handleEvents(remaining);

      const stderrRest = stderrBuffer.trim();
      stderrBuffer = "";
      if (stderrRest) {
        state.stderrTail.push(stderrRest);
        if (state.stderrTail.length > MAX_STDERR_LINES) {
          state.stderrTail.splice(0, state.stderrTail.length - MAX_STDERR_LINES);
        }
      }

      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }

      if (signal) signal.removeEventListener("abort", onAbort);

      if (state.status === "aborted") {
        // Already handled
      } else if (code !== 0 && code !== null) {
        state.status = "error";
        state.error = state.error ?? `qwen exited with code ${code}`;
      } else {
        state.status = "done";
      }
      state.endedAt = Date.now();
      onUpdate?.({ ...state });
      resolve(state);
    });

    proc.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      state.status = "error";
      state.error = err.message;
      state.endedAt = Date.now();
      onUpdate?.({ ...state });
      resolve(state);
    });
  });
}

function buildArgs(
  task: string,
  opts: {
    approvalMode?: string;
    model?: string;
    includeDirectories?: string[];
    continueSession?: boolean;
    resume?: string;
  },
): string[] {
  const args = ["-p", task, "--output-format", "stream-json"];

  const mode = opts.approvalMode || "yolo";
  if (mode === "yolo") {
    args.push("--yolo");
  } else if (mode !== "default") {
    args.push("--approval-mode", mode);
  }

  if (opts.model && /^[a-zA-Z0-9._:/-]+$/.test(opts.model)) {
    args.push("-m", opts.model);
  }

  if (opts.includeDirectories && opts.includeDirectories.length > 0) {
    for (const dir of opts.includeDirectories) {
      args.push("--include-directories", dir);
    }
  }

  if (opts.continueSession) {
    args.push("--continue");
  }

  if (opts.resume) {
    args.push("--resume", opts.resume);
  }

  return args;
}

function addToolCall(state: QwenRunState, tu: ToolUseInfo): void {
  const existing = state.toolCalls.find((c) => c.id === tu.id);
  if (existing) {
    existing.input = tu.input;
    return;
  }
  state.toolCalls.push({
    id: tu.id,
    name: tu.name,
    input: tu.input,
    startedAt: Date.now(),
  });
  if (state.toolCalls.length > MAX_TOOL_CALLS) {
    state.toolCalls.splice(0, state.toolCalls.length - MAX_TOOL_CALLS);
  }
}
