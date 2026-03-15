/**
 * Custom UI Extension
 *
 * Customizes pi's TUI with:
 * - Flower spinner animation in title bar and footer during streaming
 * - Stats widget above editor (context %, cost, model with color coding, skills)
 * - Clean single-line footer (status + path/branch)
 * - Double Esc to clear prompt input (hint shown in footer)
 *
 * Usage:
 *   pi -e pi-extensions/custom-ui.ts
 */

import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const FRAMES = ["·", "✻", "✽", "✶", "✳", "✢"];

const ANSI_BLUE = "\x1b[34m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";

const MODEL_COLORS: Record<string, string> = {
  "glm-5": ANSI_BLUE,
  "glm-4.7": ANSI_BLUE,
  "dashscope-glm-4.7": ANSI_BLUE,
  "qwen3.5-plus": ANSI_GREEN,
  "kimi-k2.5": ANSI_GREEN,
  "minimax-m2.5": ANSI_GREEN,
  "ark-code-latest": ANSI_GREEN,
  "qwen3-coder-next": ANSI_YELLOW,
  "glm-4.5-air": ANSI_YELLOW,
  "step-3.5-flash": ANSI_YELLOW,
  "openrouter-free": ANSI_YELLOW,
};

function getBaseTitle(pi: ExtensionAPI): string {
  const cwd = path.basename(process.cwd());
  const session = pi.getSessionName();
  return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
}

export default function (pi: ExtensionAPI) {
  let frameIndex = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let pendingClear = false;

  const CLEAR_TIMEOUT_MS = 1000;

  class DoubleEscEditor extends CustomEditor {
    private clearTimeout?: ReturnType<typeof setTimeout>;

    handleInput(data: string): void {
      if (matchesKey(data, "escape")) {
        if (pendingClear) {
          this.setText("");
          pendingClear = false;
          clearTimeout(this.clearTimeout);
          this.tui.requestRender();
          return;
        }

        if (this.getText().length > 0) {
          pendingClear = true;
          this.clearTimeout = setTimeout(() => {
            pendingClear = false;
            this.tui.requestRender();
          }, CLEAR_TIMEOUT_MS);
          return;
        }
      }

      if (pendingClear) {
        pendingClear = false;
        clearTimeout(this.clearTimeout);
        this.tui.requestRender();
      }

      super.handleInput(data);
    }

    dispose(): void {
      clearTimeout(this.clearTimeout);
      super.dispose?.();
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const skillCount = pi.getCommands().filter((c: any) => c.source === "skill").length;

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new DoubleEscEditor(tui, theme, keybindings),
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
          const infoRightPlain = skillCount > 0 ? `${model} · ${skillCount} skills` : model;
          const fillLen = Math.max(1, width - infoLeft.length - infoRightPlain.length);
          const modelColor = MODEL_COLORS[model];
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

          return [coloredLeft + " ".repeat(fillLen) + dim(infoRight)];
        },
      };
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      ticker = setInterval(() => {
        if (!ctx.isIdle()) {
          frameIndex++;
          // Title bar animation
          const frame = FRAMES[frameIndex % FRAMES.length];
          ctx.ui.setTitle(`${frame} ${getBaseTitle(pi)}`);
          tui.requestRender();
        }
      }, 150);

      return {
        dispose() {
          unsub();
          if (ticker) {
            clearInterval(ticker);
            ticker = null;
          }
        },
        invalidate() {},
        render(width: number): string[] {
          const streaming = !ctx.isIdle();
          const dim = (s: string) => theme.fg("dim", s);

          // Status line: ✓ Ready / ✻ Streaming Response [Esc again to clear]  ~/path (branch)
          let statusLeft: string;
          if (pendingClear) {
            statusLeft = `${ANSI_BLUE}Esc${ANSI_RESET} again to clear`;
          } else if (streaming) {
            const frame = FRAMES[frameIndex % FRAMES.length];
            statusLeft = `${theme.fg("accent", frame)} Streaming Response`;
          } else {
            statusLeft = `${theme.fg("success", "✓")} Ready`;
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
    ctx.ui.setTitle(getBaseTitle(pi));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setTitle(getBaseTitle(pi));
  });
}
