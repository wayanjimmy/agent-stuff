/**
 * Normalized event types from Qwen Code stream-json output.
 */
export type QwenEvent =
  | { kind: "system"; data: Record<string, unknown> }
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_message"; text: string; toolUse?: ToolUseInfo[] }
  | { kind: "tool_result"; toolUseId: string; isError: boolean; content: string }
  | { kind: "result"; text: string }
  | { kind: "error"; message: string }
  | { kind: "raw_text"; text: string };

export interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Streaming JSONL parser for Qwen Code `--output-format stream-json`.
 * Handles partial chunks and non-JSON lines.
 */
export class QwenStreamParser {
  private buffer = "";

  /**
   * Feed a raw chunk from stdout. Returns zero or more normalized events.
   */
  feed(chunk: string): QwenEvent[] {
    this.buffer += chunk;
    const events: QwenEvent[] = [];

    const lines = this.buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
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
  flush(): QwenEvent[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    if (!rest) return [];
    const event = this.parseLine(rest);
    return event ? [event] : [];
  }

  private parseLine(line: string): QwenEvent | null {
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

  private normalizeEvent(json: Record<string, any>): QwenEvent {
    const type = json.type as string | undefined;

    switch (type) {
      case "system":
        return { kind: "system", data: json };

      case "assistant": {
        const message = json.message;
        if (!message || typeof message !== "object") {
          return { kind: "assistant_message", text: "" };
        }

        const content = Array.isArray(message.content) ? message.content : [];
        const textParts: string[] = [];
        const toolUses: ToolUseInfo[] = [];

        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") {
            textParts.push(part.text);
          } else if (part?.type === "tool_use") {
            toolUses.push({
              id: part.id ?? "",
              name: part.name ?? "",
              input: part.input,
            });
          }
        }

        const text = textParts.join("");
        const stopReason = message.stop_reason;

        // If stop_reason is null, this is a partial/delta message
        if (stopReason === null && text) {
          return { kind: "assistant_delta", text };
        }

        return {
          kind: "assistant_message",
          text,
          toolUse: toolUses.length > 0 ? toolUses : undefined,
        };
      }

      case "user": {
        const message = json.message;
        if (!message || typeof message !== "object") {
          return { kind: "raw_text", text: JSON.stringify(json) };
        }

        const content = Array.isArray(message.content) ? message.content : [];
        for (const part of content) {
          if (part?.type === "tool_result") {
            return {
              kind: "tool_result",
              toolUseId: part.tool_use_id ?? "",
              isError: !!part.is_error,
              content:
                typeof part.content === "string"
                  ? part.content
                  : JSON.stringify(part.content ?? ""),
            };
          }
        }

        return { kind: "raw_text", text: JSON.stringify(json) };
      }

      case "result":
        return {
          kind: "result",
          text: typeof json.result === "string" ? json.result : JSON.stringify(json),
        };

      default:
        return { kind: "raw_text", text: JSON.stringify(json) };
    }
  }
}
