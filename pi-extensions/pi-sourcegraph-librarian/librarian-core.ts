import events from "node:events";

import { Type } from "@sinclair/typebox";

export const DEFAULT_MAX_TURNS = 10;
export const DEFAULT_MAX_SEARCH_RESULTS = 10;
export const MAX_TOOL_CALLS_TO_KEEP = 80;

const DEFAULT_EVENTTARGET_MAX_LISTENERS = 100;
const EVENTTARGET_MAX_LISTENERS_STATE_KEY = Symbol.for("pi.eventTargetMaxListenersState");

type EventTargetMaxListenersState = { depth: number; savedDefault?: number };

export type LibrarianStatus = "running" | "done" | "error" | "aborted";

export type ToolCall = {
  id: string;
  name: string;
  args: unknown;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
};

export interface LibrarianRunDetails {
  status: LibrarianStatus;
  query: string;
  turns: number;
  toolCalls: ToolCall[];
  summaryText?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface SubagentSelectionInfo {
  authMode: string;
  authSource: string;
  reason: string;
}

export interface LibrarianDetails {
  status: LibrarianStatus;
  workspace?: string;
  backends?: LibrarianBackend[];
  subagentProvider?: string;
  subagentModelId?: string;
  subagentSelection?: SubagentSelectionInfo;
  runs: LibrarianRunDetails[];
}

export type LibrarianBackend = "sourcegraph" | "zread";
export const ALL_BACKENDS: LibrarianBackend[] = ["sourcegraph", "zread"];
export const DEFAULT_BACKENDS: LibrarianBackend[] = ["sourcegraph"];

export function parseBackends(value: unknown): LibrarianBackend[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_BACKENDS;
  const valid = value.filter(
    (v): v is LibrarianBackend => typeof v === "string" && ALL_BACKENDS.includes(v as any),
  );
  return valid.length > 0 ? valid : DEFAULT_BACKENDS;
}

export const LibrarianParams = Type.Object({
  query: Type.String({
    description: [
      "Describe exactly what to find across public codebases.",
      "Include known context: symbols, repo patterns (e.g. repo:^github\\.com/org/repo$ or owner/repo), file patterns, language.",
      "Do not guess unknown details; let the librarian discover scope iteratively.",
      "Returns evidence-first findings with verifiable links.",
    ].join("\n"),
  }),
  repos: Type.Optional(
    Type.Array(Type.String({ description: "Optional repo filters (e.g. github.com/org/repo)" }), {
      description: "Optional repository scope.",
      maxItems: 30,
    }),
  ),
  backends: Type.Optional(
    Type.Array(Type.Enum({ sourcegraph: "sourcegraph", zread: "zread" }), {
      description:
        'Search backends to use. "sourcegraph" for broad code search (regex, symbols, diffs). "zread" for semantic doc search, full file reading, and repo structure browsing. Default: ["sourcegraph"].',
      minItems: 1,
      maxItems: 2,
      default: ["sourcegraph"],
    }),
  ),
  maxSearchResults: Type.Optional(
    Type.Number({
      description: `Maximum search results per query (1-20, default ${DEFAULT_MAX_SEARCH_RESULTS})`,
      minimum: 1,
      maximum: 20,
      default: DEFAULT_MAX_SEARCH_RESULTS,
    }),
  ),
});

function getEventTargetMaxListenersState(): EventTargetMaxListenersState {
  const g = globalThis as any;
  if (!g[EVENTTARGET_MAX_LISTENERS_STATE_KEY])
    g[EVENTTARGET_MAX_LISTENERS_STATE_KEY] = { depth: 0 };
  return g[EVENTTARGET_MAX_LISTENERS_STATE_KEY] as EventTargetMaxListenersState;
}

export function bumpDefaultEventTargetMaxListeners(): () => void {
  const state = getEventTargetMaxListenersState();

  const raw = process.env.PI_EVENTTARGET_MAX_LISTENERS ?? process.env.PI_ABORT_MAX_LISTENERS;
  const desired = raw !== undefined ? Number(raw) : DEFAULT_EVENTTARGET_MAX_LISTENERS;
  if (!Number.isFinite(desired) || desired < 0) return () => {};

  if (state.depth === 0) state.savedDefault = events.defaultMaxListeners;
  state.depth += 1;

  if (events.defaultMaxListeners < desired) events.setMaxListeners(desired);

  return () => {
    state.depth = Math.max(0, state.depth - 1);
    if (state.depth !== 0) return;
    if (state.savedDefault === undefined) return;

    events.setMaxListeners(state.savedDefault);
    state.savedDefault = undefined;
  };
}

export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function asStringArray(value: unknown, maxItems = 30): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function getLastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const parts = msg.content;
    if (!Array.isArray(parts)) continue;

    const blocks: string[] = [];
    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string") blocks.push(part.text);
    }

    if (blocks.length > 0) return blocks.join("");
  }
  return "";
}

export function computeOverallStatus(runs: LibrarianRunDetails[]): LibrarianStatus {
  if (runs.some((r) => r.status === "running")) return "running";
  if (runs.some((r) => r.status === "error")) return "error";
  if (runs.every((r) => r.status === "aborted")) return "aborted";
  return "done";
}

export function renderCombinedMarkdown(runs: LibrarianRunDetails[]): string {
  const r = runs[0];
  return (r.summaryText ?? (r.status === "running" ? "(searching...)" : "(no output)")).trim();
}

export function formatToolCall(call: ToolCall): string {
  const args =
    call.args && typeof call.args === "object" ? (call.args as Record<string, any>) : undefined;

  if (call.name === "read") {
    const p = typeof args?.path === "string" ? args.path : "";
    const offset = typeof args?.offset === "number" ? args.offset : undefined;
    const limit = typeof args?.limit === "number" ? args.limit : undefined;
    const range =
      offset || limit ? `:${offset ?? 1}${limit ? `-${(offset ?? 1) + limit - 1}` : ""}` : "";
    return `read ${p}${range}`;
  }

  if (call.name === "bash") {
    const command = typeof args?.command === "string" ? args.command : "";
    const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
    const normalized = command.replace(/\s+/g, " ").trim();
    const suffix = timeout ? ` (timeout ${timeout}s)` : "";
    return `bash ${shorten(normalized, 120)}${suffix}`.trimEnd();
  }

  return call.name;
}
