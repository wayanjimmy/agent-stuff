/**
 * Zellij Control Extension
 *
 * Run commands in new Zellij panes with a focus on background-process workflows.
 *
 * Main tool:
 *   - zellij_exec_in_pane: create a pane, run a command, optionally wait,
 *     and return captured pane output.
 *
 * Safety behavior:
 *   - Fails fast with an actionable error when Pi is not currently running
 *     inside a Zellij session.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

const DEFAULT_TIMEOUT_SEC = 180;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

const ZellijExecParams = Type.Object({
  session: Type.Optional(
    Type.String({
      description:
        "Target Zellij session name. Defaults to the current Zellij session (ZELLIJ_SESSION_NAME).",
    }),
  ),
  command: Type.String({
    description:
      "Shell command to execute in the new pane. This is run as: bash -lc '<command>'.",
  }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the pane command." }),
  ),
  pane_name: Type.Optional(
    Type.String({ description: "Optional pane name (eg. 'build', 'server', 'worker')." }),
  ),
  direction: Type.Optional(
    StringEnum(["left", "right", "up", "down"] as const, {
      description: "Direction for non-floating pane placement.",
    }),
  ),
  floating: Type.Optional(
    Type.Boolean({ description: "Open as a floating pane (default: false)." }),
  ),
  wait_mode: Type.Optional(
    StringEnum(["non_blocking", "until_exit", "until_exit_success", "until_exit_failure"] as const, {
      description:
        "Execution mode: non_blocking returns immediately; until_exit variants block using Zellij pane blocking flags.",
      default: "until_exit",
    }),
  ),
  output_mode: Type.Optional(
    StringEnum(["final_snapshot"] as const, {
      description:
        "Output capture mode. 'final_snapshot' captures pane output with dump-screen.",
      default: "final_snapshot",
    }),
  ),
  include_scrollback: Type.Optional(
    Type.Boolean({
      description: "Include full scrollback in captured output (default: true).",
      default: true,
    }),
  ),
  ansi: Type.Optional(
    Type.Boolean({
      description: "Preserve ANSI escape codes in captured output.",
      default: false,
    }),
  ),
  timeout_sec: Type.Optional(
    Type.Number({
      description: "Timeout for each zellij command execution.",
      minimum: 5,
      maximum: 3600,
      default: DEFAULT_TIMEOUT_SEC,
    }),
  ),
  max_output_chars: Type.Optional(
    Type.Number({
      description: "Maximum pane output characters returned to the model.",
      minimum: 500,
      maximum: 200_000,
      default: DEFAULT_MAX_OUTPUT_CHARS,
    }),
  ),
});

type ZellijExecParamsType = Static<typeof ZellijExecParams>;

type PaneInfo = {
  id: number;
  is_plugin: boolean;
  title?: string;
  exited?: boolean;
  exit_status?: number | null;
  tab_id?: number;
  tab_name?: string;
};

function paneInfoToPaneId(pane: PaneInfo): string {
  return `${pane.is_plugin ? "plugin" : "terminal"}_${pane.id}`;
}

function inZellijNow(): boolean {
  return Boolean(process.env.ZELLIJ || process.env.ZELLIJ_PANE_ID);
}

function getCurrentZellijSessionName(): string | null {
  const session = process.env.ZELLIJ_SESSION_NAME?.trim();
  return session ? session : null;
}

function parsePaneId(raw: string): string | null {
  const match = raw.match(/(terminal_\d+|plugin_\d+|\b\d+\b)/);
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? `terminal_${match[1]}` : match[1];
}

function paneIdToParts(paneId: string): { id: number; isPlugin: boolean } | null {
  const m = paneId.match(/^(terminal|plugin)_(\d+)$/);
  if (!m) return null;
  return {
    id: Number.parseInt(m[2], 10),
    isPlugin: m[1] === "plugin",
  };
}

function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const note = `\n\n[Output truncated. Showing last ${maxChars.toLocaleString()} characters.]\n\n`;
  const budget = Math.max(0, maxChars - note.length);
  return note + text.slice(-budget);
}

async function listPanes(pi: ExtensionAPI, session: string, timeoutMs: number, signal?: AbortSignal): Promise<PaneInfo[]> {
  const result = await pi.exec("zellij", ["--session", session, "action", "list-panes", "--json"], {
    timeout: timeoutMs,
    signal,
  });
  if (result.code !== 0) return [];
  try {
    return JSON.parse(result.stdout) as PaneInfo[];
  } catch {
    return [];
  }
}

export default function zellijControlExtension(pi: ExtensionAPI) {
  pi.registerCommand("zellij-status", {
    description: "Show whether Pi is running inside Zellij and basic zellij availability",
    async handler(_args, ctx: any) {
      const inside = inZellijNow();
      const currentSession = getCurrentZellijSessionName();
      const version = await pi.exec("zellij", ["--version"]);

      if (version.code !== 0) {
        ctx.ui.notify("zellij binary not found in PATH", "error");
        return;
      }

      if (!inside) {
        ctx.ui.notify("Pi is NOT running inside Zellij", "warning");
        return;
      }

      ctx.ui.notify(
        `Pi is inside Zellij (session: ${currentSession ?? "unknown"}) • ${version.stdout.trim()}`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "zellij_exec_in_pane",
    label: "Zellij Exec In Pane",
    description:
      "Create a new Zellij pane, execute a command (including long-running background processes), and read pane output.",
    promptSnippet:
      "Run commands in background-friendly Zellij panes and capture pane output for monitoring.",
    promptGuidelines: [
      "Use this tool when the user wants to run a process in the background or monitor a command in a dedicated pane.",
      "If a command should keep running (dev server, watcher), set wait_mode to non_blocking.",
      "Use pane_name to make process panes easier to identify.",
    ],
    parameters: ZellijExecParams,

    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as ZellijExecParamsType;

      if (!inZellijNow()) {
        throw new Error(
          "This tool requires Pi to run inside an active Zellij session. Start Zellij first (`zellij`), then run Pi inside it and try again.",
        );
      }

      const timeoutMs = Math.round((params.timeout_sec ?? DEFAULT_TIMEOUT_SEC) * 1000);
      const waitMode = params.wait_mode ?? "until_exit";
      const includeScrollback = params.include_scrollback ?? true;
      const outputMode = params.output_mode ?? "final_snapshot";
      const floating = params.floating ?? false;
      const maxOutputChars = Math.round(params.max_output_chars ?? DEFAULT_MAX_OUTPUT_CHARS);
      const session = params.session?.trim() || getCurrentZellijSessionName();

      if (!session) {
        throw new Error(
          "Could not determine Zellij session name. Set the `session` parameter or ensure ZELLIJ_SESSION_NAME is available.",
        );
      }

      if (outputMode !== "final_snapshot") {
        throw new Error(`Unsupported output_mode: ${outputMode}`);
      }

      const zellijVersion = await pi.exec("zellij", ["--version"], { timeout: timeoutMs, signal });
      if (zellijVersion.code !== 0) {
        throw new Error((zellijVersion.stderr || zellijVersion.stdout || "zellij not available").trim());
      }

      // Ensure target session exists. Avoid `attach --create-background` for the current
      // session because zellij errors when "attaching" to itself.
      const currentSession = getCurrentZellijSessionName();
      if (!currentSession || session !== currentSession) {
        const ensure = await pi.exec("zellij", ["attach", "--create-background", session], {
          timeout: timeoutMs,
          signal,
        });
        if (ensure.code !== 0) {
          throw new Error(
            `Could not create/attach background session '${session}': ${(ensure.stderr || ensure.stdout || "unknown error").trim()}`,
          );
        }
      }

      const panesBefore = await listPanes(pi, session, timeoutMs, signal);
      const beforeIds = new Set(panesBefore.map(paneInfoToPaneId));

      const newPaneArgs = ["--session", session, "action", "new-pane"];

      if (params.pane_name?.trim()) {
        newPaneArgs.push("--name", params.pane_name.trim());
      }

      if (params.cwd?.trim()) {
        newPaneArgs.push("--cwd", params.cwd.trim());
      }

      if (floating) {
        newPaneArgs.push("--floating");
      } else if (params.direction) {
        newPaneArgs.push("--direction", params.direction);
      }

      if (waitMode === "until_exit") newPaneArgs.push("--block-until-exit");
      if (waitMode === "until_exit_success") newPaneArgs.push("--block-until-exit-success");
      if (waitMode === "until_exit_failure") newPaneArgs.push("--block-until-exit-failure");

      newPaneArgs.push("--", "bash", "-lc", params.command);

      const newPane = await pi.exec("zellij", newPaneArgs, { timeout: timeoutMs, signal });
      if (newPane.code !== 0) {
        throw new Error(
          `Failed creating/running pane: ${(newPane.stderr || newPane.stdout || "unknown error").trim()}`,
        );
      }

      let paneId = parsePaneId(`${newPane.stdout}\n${newPane.stderr}`);
      if (!paneId) {
        const panesAfter = await listPanes(pi, session, timeoutMs, signal);
        const created = panesAfter.find((p) => !beforeIds.has(paneInfoToPaneId(p)));
        if (created) paneId = paneInfoToPaneId(created);
      }
      if (!paneId) {
        throw new Error(
          `Command ran but pane id could not be parsed from output and could not be inferred from pane list diffs. zellij output: ${(newPane.stdout || newPane.stderr || "(empty)").trim()}`,
        );
      }

      const dumpArgs = ["--session", session, "action", "dump-screen", "--pane-id", paneId];
      if (includeScrollback) dumpArgs.push("--full");
      if (params.ansi) dumpArgs.push("--ansi");

      const dump = await pi.exec("zellij", dumpArgs, { timeout: timeoutMs, signal });
      if (dump.code !== 0) {
        throw new Error(
          `Failed reading pane output for ${paneId}: ${(dump.stderr || dump.stdout || "unknown error").trim()}`,
        );
      }

      let paneInfo: PaneInfo | undefined;
      const panes = await listPanes(pi, session, timeoutMs, signal);
      const parsed = paneIdToParts(paneId);
      if (parsed) {
        paneInfo = panes.find((p) => p.id === parsed.id && p.is_plugin === parsed.isPlugin);
      }

      const output = truncateOutput((dump.stdout || "").trim(), maxOutputChars);
      const summary = [
        `session: ${session}`,
        `pane_id: ${paneId}`,
        `wait_mode: ${waitMode}`,
        `output_mode: ${outputMode}`,
        paneInfo ? `exited: ${String(Boolean(paneInfo.exited))}` : "exited: unknown",
        paneInfo && paneInfo.exit_status != null ? `exit_status: ${paneInfo.exit_status}` : undefined,
        paneInfo?.tab_name ? `tab: ${paneInfo.tab_name}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `${summary}\n\noutput:\n\n${output || "(no output captured)"}`,
          },
        ],
        details: {
          session,
          paneId,
          waitMode,
          outputMode,
          paneInfo,
          outputLength: (dump.stdout || "").length,
          truncatedTo: maxOutputChars,
        },
      };
    },
  });
}
