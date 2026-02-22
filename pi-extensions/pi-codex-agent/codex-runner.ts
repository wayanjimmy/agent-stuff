import { spawn } from "node:child_process";

import { CodexStreamParser, type CodexEvent } from "./codex-stream-parser.ts";

export type CodexStatus = "running" | "done" | "error" | "aborted";

export interface CodexCommand {
  command: string;
  exitCode?: number;
  status: string;
  startedAt: number;
  endedAt?: number;
}

export interface CodexRunState {
  status: CodexStatus;
  threadId?: string;
  lastAssistantMessage: string;
  commands: CodexCommand[];
  stderrTail: string[];
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  startedAt: number;
  endedAt?: number;
}

const MAX_COMMANDS = 80;
const MAX_STDERR_LINES = 20;
const THROTTLE_MS = 150;

export interface CodexRunnerOptions {
  task: string;
  cwd?: string;
  sandbox?: string;
  model?: string;
  profile?: string;
  fullAuto?: boolean;
  addDirs?: string[];
  signal?: AbortSignal;
  onUpdate?: (state: CodexRunState) => void;
}

export async function runCodexAgent(options: CodexRunnerOptions): Promise<CodexRunState> {
  const { task, cwd, sandbox, model, profile, fullAuto, addDirs, signal, onUpdate } = options;

  const args = buildArgs(task, { sandbox, model, profile, fullAuto, addDirs });

  const state: CodexRunState = {
    status: "running",
    lastAssistantMessage: "",
    commands: [],
    stderrTail: [],
    startedAt: Date.now(),
  };

  if (signal?.aborted) {
    state.status = "aborted";
    state.endedAt = Date.now();
    return state;
  }

  const proc = spawn("codex", args, {
    cwd: cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const parser = new CodexStreamParser();
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

  const handleEvents = (events: CodexEvent[]) => {
    for (const event of events) {
      switch (event.kind) {
        case "thread_started":
          state.threadId = event.threadId;
          break;

        case "turn_started":
          break;

        case "agent_message":
          if (event.text) {
            state.lastAssistantMessage = event.text;
          }
          break;

        case "reasoning":
          break;

        case "command_execution": {
          const existing = state.commands.find(
            (c) => c.command === event.command && c.status === "running",
          );
          if (existing) {
            existing.exitCode = event.exitCode;
            existing.status = event.status;
            existing.endedAt = Date.now();
          } else {
            state.commands.push({
              command: event.command,
              exitCode: event.exitCode,
              status: event.status,
              startedAt: Date.now(),
            });
            if (state.commands.length > MAX_COMMANDS) {
              state.commands.splice(0, state.commands.length - MAX_COMMANDS);
            }
          }
          break;
        }

        case "turn_completed":
          if (event.usage) state.usage = event.usage;
          break;

        case "error":
          state.error = event.message;
          break;

        case "raw_text":
          state.stderrTail.push(event.text);
          if (state.stderrTail.length > MAX_STDERR_LINES) {
            state.stderrTail.splice(0, state.stderrTail.length - MAX_STDERR_LINES);
          }
          break;
      }
    }
    throttledUpdate();
  };

  return new Promise<CodexRunState>((resolve) => {
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
      const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
      state.stderrTail.push(...lines);
      if (state.stderrTail.length > MAX_STDERR_LINES) {
        state.stderrTail.splice(0, state.stderrTail.length - MAX_STDERR_LINES);
      }
      throttledUpdate();
    });

    proc.on("close", (code) => {
      const remaining = parser.flush();
      if (remaining.length > 0) handleEvents(remaining);

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
        state.error = state.error ?? `codex exited with code ${code}`;
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
    sandbox?: string;
    model?: string;
    profile?: string;
    fullAuto?: boolean;
    addDirs?: string[];
  },
): string[] {
  const args = ["exec", "--json", task];

  if (opts.sandbox) {
    args.push("--sandbox", opts.sandbox);
  }

  if (opts.model) {
    args.push("-m", opts.model);
  }

  if (opts.profile) {
    args.push("-p", opts.profile);
  }

  if (opts.fullAuto) {
    args.push("--full-auto");
  }

  if (opts.addDirs && opts.addDirs.length > 0) {
    for (const dir of opts.addDirs) {
      args.push("--add-dir", dir);
    }
  }

  return args;
}
