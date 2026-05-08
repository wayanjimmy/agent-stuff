/**
 * xurl Extension
 *
 * Integrates the xurl CLI tool for reading cross-agent threads
 * (Codex, Claude, Gemini, Amp, Pi, OpenCode).
 *
 * Provides:
 *   - /xurl <uri> slash command
 *   - read_agent_thread tool for LLM use
 *
 * Usage:
 *   pi -e pi-extensions/xurl.ts
 */

import type { ExtensionAPI, ExtensionContext, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_PROVIDERS = ["codex", "claude", "gemini", "amp", "pi", "opencode"];
const DEFAULT_MAX_CHARS = 12_000;
const TRUNCATION_NOTE = "\n\n[Thread truncated...]";

interface XurlDetails {
  uri: string;
  success: boolean;
  charsReturned?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTarget(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("agents://")) return trimmed;
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    const provider = trimmed.slice(0, slash).toLowerCase();
    if (KNOWN_PROVIDERS.includes(provider)) {
      return `agents://${trimmed}`;
    }
  }
  return trimmed;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function stripFrontmatter(text: string): string {
  // xurl output can vary slightly across versions (CRLF, leading BOM/whitespace).
  // Normalize and strip YAML frontmatter defensively.
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  const trimmedStart = normalized.trimStart();
  if (!trimmedStart.startsWith("---\n")) return normalized;

  const leadingWsLen = normalized.length - trimmedStart.length;
  const end = trimmedStart.indexOf("\n---\n", 4);
  if (end === -1) return normalized;

  return normalized.slice(leadingWsLen + end + "\n---\n".length);
}

function stripSystemBlocks(text: string): string {
  return text
    .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/g, "[system instructions omitted]")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, "");
}

function extractThreadBody(text: string): string {
  const marker = text.match(/^# (Thread|Subagent Thread)\s*$/m);
  if (!marker || marker.index == null) return text;
  return text.slice(marker.index);
}

function cleanOutput(text: string): string {
  const withoutFrontmatter = stripFrontmatter(text);
  const threadBody = extractThreadBody(withoutFrontmatter);
  return stripSystemBlocks(threadBody).replace(/\n{3,}/g, "\n\n").trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}

async function execXurl(
  pi: ExtensionAPI,
  target: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; output: string }> {
  const result = await pi.exec("xurl", [target], { signal });
  if (result.code !== 0) {
    const err = stripAnsi(result.stderr || result.stdout || "Unknown error");
    return { ok: false, output: err.trim() || `xurl exited with code ${result.code}` };
  }
  return { ok: true, output: cleanOutput(stripAnsi(result.stdout)) };
}

// ---------------------------------------------------------------------------
// Tool parameters
// ---------------------------------------------------------------------------

const ReadAgentThreadParams = Type.Object({
  uri: Type.String({
    description:
      "Thread URI — either full (agents://codex/id) or shorthand (codex/id). " +
      "Known providers: codex, claude, gemini, amp, pi, opencode.",
  }),
  max_chars: Type.Optional(
    Type.Number({
      description: "Maximum characters to return (default 12000)",
      minimum: 1000,
      maximum: 100_000,
      default: DEFAULT_MAX_CHARS,
    }),
  ),
});

type ReadAgentThreadParamsType = Static<typeof ReadAgentThreadParams>;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function xurlExtension(pi: ExtensionAPI) {
  // -- Slash command: /xurl <uri> -------------------------------------------
  pi.registerCommand("xurl", {
    description: "Read a cross-agent thread by URI (e.g. /xurl codex/019cd...)",
    async handler(args: string, ctx: any) {
      const target = args.trim();
      if (!target) {
        pi.sendMessage(
          { customType: "xurl", content: "Usage: /xurl <provider/thread-id>", display: true },
          { triggerTurn: false },
        );
        return;
      }

      const uri = normalizeTarget(target);
      const { ok, output } = await execXurl(pi, uri);

      if (!ok) {
        pi.sendMessage(
          { customType: "xurl", content: `**xurl error:** ${output}`, display: true },
          { triggerTurn: false },
        );
        return;
      }

      const content = truncate(output, DEFAULT_MAX_CHARS);
      pi.sendMessage(
        { customType: "xurl", content: `**Thread: ${target}**\n\n${content}`, display: true },
        { triggerTurn: true },
      );
    },
  });

  // -- LLM tool: read_agent_thread ------------------------------------------
  pi.registerTool({
    name: "read_agent_thread",
    label: "Read Agent Thread",
    description:
      "Read a cross-agent thread from Codex, Claude, Gemini, Amp, Pi, or OpenCode.\n" +
      "Use when the user references an agent thread URI such as agents://codex/..., " +
      "or shorthand like codex/..., claude/..., gemini/..., amp/..., pi/..., opencode/...\n\n" +
      "Examples:\n" +
      '  {"uri":"codex/019cd0b3-57f3-7812-8350-b4ab28473dc2"}\n' +
      '  {"uri":"agents://claude/abc123","max_chars":20000}',
    parameters: ReadAgentThreadParams,

    async execute(
      _toolCallId: string,
      rawParams: unknown,
      _signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback<XurlDetails> | undefined,
      _ctx: ExtensionContext,
    ) {
      const params = rawParams as ReadAgentThreadParamsType;
      const uri = normalizeTarget(params.uri);
      const maxChars = params.max_chars ?? DEFAULT_MAX_CHARS;

      const { ok, output } = await execXurl(pi, uri, _signal);

      if (!ok) {
        throw new Error(`Error reading thread: ${output}`);
      }

      const truncated = truncate(output, maxChars);
      return {
        content: [{ type: "text", text: truncated }],
        details: {
          uri,
          success: true,
          charsReturned: truncated.length,
        },
      };
    },
  });
}
