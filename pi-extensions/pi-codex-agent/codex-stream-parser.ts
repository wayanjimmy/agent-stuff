/**
 * Normalized event types from Codex `exec --json` JSONL output.
 */
export type CodexEvent =
  | { kind: "thread_started"; threadId: string }
  | { kind: "turn_started" }
  | { kind: "agent_message"; text: string; isComplete: boolean }
  | { kind: "reasoning"; text: string }
  | { kind: "command_execution"; id?: string; command: string; exitCode?: number; status: string }
  | { kind: "turn_completed"; usage?: TokenUsage }
  | { kind: "error"; message: string }
  | { kind: "raw_text"; text: string };

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Streaming JSONL parser for Codex `exec --json`.
 * Handles partial chunks and non-JSON lines.
 */
export class CodexStreamParser {
  private buffer = "";

  /**
   * Feed a raw chunk from stdout. Returns zero or more normalized events.
   */
  feed(chunk: string): CodexEvent[] {
    this.buffer += chunk;
    const events: CodexEvent[] = [];

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const event = this.parseLine(trimmed);
      if (event) events.push(event);
    }

    return events;
  }

  /**
   * Flush any remaining buffer content (call after stream ends).
   */
  flush(): CodexEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const event = this.parseLine(rest);
    return event ? [event] : [];
  }

  private parseLine(line: string): CodexEvent | null {
    let json: any;
    try {
      json = JSON.parse(line);
    } catch {
      return { kind: "raw_text", text: line };
    }

    if (typeof json !== "object" || json === null) {
      return { kind: "raw_text", text: line };
    }

    return this.normalizeEvent(json);
  }

  private normalizeEvent(json: Record<string, any>): CodexEvent {
    const type = json.type as string | undefined;

    switch (type) {
      case "thread.started":
        return {
          kind: "thread_started",
          threadId: typeof json.thread_id === "string" ? json.thread_id : "",
        };

      case "turn.started":
        return { kind: "turn_started" };

      case "item.started":
      case "item.completed": {
        const item = json.item ?? json;
        const itemType = item.type as string | undefined;

        if (itemType === "agent_message") {
          return {
            kind: "agent_message",
            text: typeof item.text === "string" ? item.text : "",
            isComplete: type === "item.completed",
          };
        }

        if (itemType === "reasoning") {
          return {
            kind: "reasoning",
            text: typeof item.text === "string" ? item.text : "",
          };
        }

        if (itemType === "command_execution") {
          return {
            kind: "command_execution",
            id: typeof item.id === "string" ? item.id : undefined,
            command: typeof item.command === "string" ? item.command : "",
            exitCode: typeof item.exit_code === "number" ? item.exit_code : undefined,
            status:
              typeof item.status === "string"
                ? item.status
                : type === "item.completed"
                  ? "completed"
                  : "running",
          };
        }

        return { kind: "raw_text", text: JSON.stringify(json) };
      }

      case "turn.completed": {
        const usage = json.usage;
        const tokenUsage: TokenUsage | undefined =
          usage && typeof usage === "object"
            ? {
                inputTokens:
                  typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
                outputTokens:
                  typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
                totalTokens:
                  typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
              }
            : undefined;
        return { kind: "turn_completed", usage: tokenUsage };
      }

      case "error":
        return {
          kind: "error",
          message: typeof json.message === "string" ? json.message : JSON.stringify(json),
        };

      default:
        return { kind: "raw_text", text: JSON.stringify(json) };
    }
  }
}
