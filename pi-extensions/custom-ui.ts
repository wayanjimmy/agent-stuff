/**
 * Custom UI Extension
 *
 * Customizes pi's TUI with:
 * - Wave spinner animation in title bar and footer while waiting/streaming
 * - Stats widget above editor (context %, cost, model with color coding, skills)
 * - Clean single-line footer (status + path/branch)
 * - Double Esc to clear prompt input (hint shown in footer)
 * - Double Ctrl+C to quit when idle (hint shown in footer)
 *
 * Usage:
 *   pi -e pi-extensions/custom-ui.ts
 */

import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type KeybindingsManager,
} from "@mariozechner/pi-coding-agent";
import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const WAVE_FRAMES = ["∼", "≈", "≋", "≈"];

const ANSI_BLUE = "\x1b[34m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";

const MODEL_COLORS: Record<string, string> = {
  "glm-5": ANSI_BLUE,
  "glm-4.7": ANSI_BLUE,
  "dashscope-glm-4.7": ANSI_BLUE,
  "gpt-5.3-codex": ANSI_BLUE,
  "qwen3.5-plus": ANSI_GREEN,
  "kimi-k2.5": ANSI_GREEN,
  "minimax-m2.5": ANSI_GREEN,
  "ark-code-latest": ANSI_GREEN,
  "qwen3-coder-next": ANSI_YELLOW,
  "glm-4.5-air": ANSI_YELLOW,
  "step-3.5-flash": ANSI_YELLOW,
  "openrouter-free": ANSI_YELLOW,
  "flash": ANSI_YELLOW,
  "turbo": ANSI_YELLOW,
};

function getBaseTitle(pi: ExtensionAPI): string {
  const cwd = path.basename(process.cwd());
  const session = pi.getSessionName();
  return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
}

function formatKey(key: string | undefined): string {
  if (!key) return "that key";

  return key
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl") return "Ctrl";
      if (lower === "alt") return "Alt";
      if (lower === "shift") return "Shift";
      if (lower === "cmd" || lower === "meta") return "Cmd";
      return part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1);
    })
    .join("+");
}

export default function (pi: ExtensionAPI) {
  let frameIndex = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let responsePhase: "idle" | "waiting" | "streaming" = "idle";
  let pendingAction: "clear" | "quit" | null = null;
  let pendingActionTimeout: ReturnType<typeof setTimeout> | null = null;

  let geminiAcpActive = false;
  let geminiAcpPhase: "idle" | "waiting" | "streaming" = "idle";
  let activeTui: any | null = null;
  let clearKeyLabel = "Ctrl+C";

  const CONFIRM_TIMEOUT_MS = 1000;

  const requestRender = () => activeTui?.requestRender?.();

  const clearPendingAction = (shouldRender = true) => {
    pendingAction = null;
    if (pendingActionTimeout) {
      clearTimeout(pendingActionTimeout);
      pendingActionTimeout = null;
    }
    if (shouldRender) {
      requestRender();
    }
  };

  const armPendingAction = (action: "clear" | "quit") => {
    clearPendingAction(false);
    pendingAction = action;
    pendingActionTimeout = setTimeout(() => {
      pendingAction = null;
      pendingActionTimeout = null;
      requestRender();
    }, CONFIRM_TIMEOUT_MS);
    requestRender();
  };

  class ConfirmingEditor extends CustomEditor {
    constructor(
      tui: any,
      theme: any,
      private readonly appKeybindings: KeybindingsManager,
      private readonly callbacks: {
        isBusy: () => boolean;
        shutdown: () => void;
      },
    ) {
      super(tui, theme, appKeybindings);
    }

    handleInput(data: string): void {
      if (isKeyRelease(data)) {
        super.handleInput(data);
        return;
      }

      if (this.appKeybindings.matches(data, "app.clear")) {
        if (this.callbacks.isBusy()) {
          clearPendingAction();
          super.handleInput(data);
          return;
        }

        if (pendingAction === "quit") {
          clearPendingAction(false);
          this.callbacks.shutdown();
          return;
        }

        armPendingAction("quit");
        if (this.getText().length > 0) {
          super.handleInput(data);
        }
        return;
      }

      if (matchesKey(data, "escape") && this.getText().length > 0) {
        if (pendingAction === "clear") {
          this.setText("");
          clearPendingAction(false);
          this.tui.requestRender();
          return;
        }

        armPendingAction("clear");
        return;
      }

      if (pendingAction) {
        clearPendingAction();
      }

      super.handleInput(data);
    }
  }

  pi.on("agent_start", async () => {
    responsePhase = "waiting";
  });

  pi.on("message_update", async (event) => {
    if ((event as any).message?.role === "assistant" && responsePhase !== "streaming") {
      responsePhase = "streaming";
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    responsePhase = ctx.isIdle() ? "idle" : "waiting";
  });

  pi.on("session_start", async (_event, ctx) => {
    const onGeminiAcpUiState = (payload: any) => {
      const phase = payload?.phase as "idle" | "waiting" | "streaming" | undefined;
      if (!phase) return;
      geminiAcpPhase = phase;
      geminiAcpActive = phase !== "idle";
      activeTui?.requestRender?.();
    };

    const offGeminiAcpUiState = pi.events.on("gemini-acp:ui-state", onGeminiAcpUiState);
    responsePhase = "idle";
    clearPendingAction(false);
    const skillCount = pi.getCommands().filter((c: any) => c.source === "skill").length;

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => {
        clearKeyLabel = formatKey(keybindings.getKeys("app.clear")[0]);
        return new ConfirmingEditor(tui, theme, keybindings, {
          isBusy: () => !ctx.isIdle() || geminiAcpActive,
          shutdown: () => ctx.shutdown(),
        });
      },
    );

    // Stats widget above the editor
    ctx.ui.setWidget("stats-rule", (tui, theme) => {
      return {
        invalidate() {},
        render(width: number): string[] {
          const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
          const dim = (s: string) => theme.fg("dim", s);

          let cost = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              cost += m.usage.cost.total;
            }
          }

          const usage = ctx.getContextUsage();
          const pct = usage?.percent;
          const ctxWindow = ctx.model?.contextWindow;

          let infoLeft = `$${cost.toFixed(2)}`;
          if (pct != null && ctxWindow) {
            infoLeft = `${Math.round(pct)}% of ${fmt(ctxWindow)} · ${infoLeft}`;
          }

          const model = ctx.model?.id?.replace(/^.*\//, "") ?? "";
          const modelColorKey = Object.keys(MODEL_COLORS).find((k) => model.includes(k));
          const modelColor = modelColorKey ? MODEL_COLORS[modelColorKey] : undefined;
          const coloredModel = modelColor ? `${modelColor}${model}${ANSI_RESET}` : dim(model);
          const infoRight =
            skillCount > 0 ? coloredModel + dim(` · ${skillCount} skills`) : coloredModel;

          let coloredLeft: string;
          if (pct != null && pct > 90) {
            const ctxPart = `${Math.round(pct)}% of ${fmt(ctxWindow!)}`;
            coloredLeft = theme.fg("error", ctxPart) + dim(` · $${cost.toFixed(2)}`);
          } else if (pct != null && pct > 70) {
            const ctxPart = `${Math.round(pct)}% of ${fmt(ctxWindow!)}`;
            coloredLeft = theme.fg("warning", ctxPart) + dim(` · $${cost.toFixed(2)}`);
          } else {
            coloredLeft = dim(infoLeft);
          }

          const leftWidth = visibleWidth(coloredLeft);
          const rightWidth = visibleWidth(infoRight);

          if (leftWidth + 1 + rightWidth <= width) {
            const gap = width - leftWidth - rightWidth;
            return [coloredLeft + " ".repeat(gap) + infoRight];
          }

          const rightBudget = Math.max(0, Math.min(rightWidth, width - 1));
          const rightPart = truncateToWidth(infoRight, rightBudget);
          const leftBudget = Math.max(0, width - visibleWidth(rightPart) - 1);
          const leftPart = truncateToWidth(coloredLeft, leftBudget);

          return [truncateToWidth(`${leftPart} ${rightPart}`, width)];
        },
      };
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui;
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      let wasAnimating = false;
      ticker = setInterval(() => {
        const busy = !ctx.isIdle() || geminiAcpActive;
        if (busy) {
          wasAnimating = true;
          frameIndex = Math.floor(Date.now() / 120) % WAVE_FRAMES.length;
          // Title bar animation
          const frame = WAVE_FRAMES[frameIndex];
          ctx.ui.setTitle(`${frame} ${getBaseTitle(pi)}`);
          tui.requestRender();
        } else if (wasAnimating) {
          wasAnimating = false;
          ctx.ui.setTitle(getBaseTitle(pi));
          tui.requestRender();
        }
      }, 60);

      return {
        dispose() {
          unsub();
          if (typeof offGeminiAcpUiState === "function") {
            offGeminiAcpUiState();
          }
          clearPendingAction(false);
          geminiAcpActive = false;
          geminiAcpPhase = "idle";
          activeTui = null;
          if (ticker) {
            clearInterval(ticker);
            ticker = null;
          }
        },
        invalidate() {},
        render(width: number): string[] {
          const busy = !ctx.isIdle() || geminiAcpActive;
          const dim = (s: string) => theme.fg("dim", s);

          // Status line: ✓ Ready / ~ Waiting for Response / ~~ Streaming Response / confirm hints
          let statusLeft: string;
          if (pendingAction === "quit") {
            statusLeft = `${ANSI_YELLOW}${clearKeyLabel}${ANSI_RESET} again to quit`;
          } else if (pendingAction === "clear") {
            statusLeft = `${ANSI_BLUE}Esc${ANSI_RESET} again to clear`;
          } else if (busy) {
            const activePhase = geminiAcpActive ? geminiAcpPhase : responsePhase;
            const label = activePhase === "streaming" ? "Streaming Response" : "Waiting for Response";
            const wave = WAVE_FRAMES[frameIndex];
            statusLeft = `${theme.fg("accent", wave)} ${label}`;
          } else {
            const extStatuses = footerData.getExtensionStatuses();
            const cavemanStatus = extStatuses.get("caveman");
            statusLeft = `${theme.fg("success", "✓")} Ready` + (cavemanStatus ? ` · ${cavemanStatus}` : "");
          }

          const cwd = process.env.HOME
            ? process.cwd().replace(process.env.HOME, "~")
            : process.cwd();
          const branch = footerData.getGitBranch();
          const statusRight = dim(branch ? `${cwd} (${branch})` : cwd);

          const gap = Math.max(1, width - visibleWidth(statusLeft) - visibleWidth(statusRight));
          return [truncateToWidth(statusLeft + " ".repeat(gap) + statusRight, width)];
        },
      };
    });
  });

  pi.on("agent_end", async (_event, ctx) => {
    clearPendingAction();
    responsePhase = "idle";
    ctx.ui.setTitle(getBaseTitle(pi));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearPendingAction(false);
    responsePhase = "idle";
    ctx.ui.setTitle(getBaseTitle(pi));
  });
}
