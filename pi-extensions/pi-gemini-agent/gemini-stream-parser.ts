/**
 * Stream parser for Gemini CLI output (stream-json format)
 */

export type GeminiEventKind =
  | "system"
  | "assistant_delta"
  | "assistant_message"
  | "tool_result"
  | "result"
  | "error"
  | "raw_text";

export interface GeminiEvent {
  kind: GeminiEventKind;
  data?: unknown;
  text?: string;
  toolUse?: ToolUseInfo[];
  toolUseId?: string;
  isError?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  message?: string;
}

export interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

export class GeminiStreamParser {
  private buffer = "";

  feed(chunk: string): GeminiEvent[] {
    this.buffer += chunk;
    const events: GeminiEvent[] = [];

    // Split by newlines and process each line
    const lines = this.buffer.split("\n");
    // Keep the last potentially incomplete line in the buffer
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        const event = this.parseLine(parsed);
        if (event) {
          events.push(event);
        }
      } catch {
        // If it's not valid JSON, emit as raw text
        events.push({ kind: "raw_text", text: line });
      }
    }

    return events;
  }

  flush(): GeminiEvent[] {
    const events: GeminiEvent[] = [];
    if (this.buffer.trim()) {
      try {
        const parsed = JSON.parse(this.buffer);
        const event = this.parseLine(parsed);
        if (event) {
          events.push(event);
        }
      } catch {
        events.push({ kind: "raw_text", text: this.buffer });
      }
    }
    this.buffer = "";
    return events;
  }

  private parseLine(data: unknown): GeminiEvent | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const obj = data as Record<string, unknown>;

    const type = typeof obj.type === "string" ? obj.type : "";

    // Handle init event (session info)
    if (type === "init") {
      return {
        kind: "system",
        data: obj,
      };
    }

    // Handle message events
    if (type === "message") {
      const role = typeof obj.role === "string" ? obj.role : "";

      // Assistant message with delta (streaming)
      if (role === "assistant" && obj.delta === true) {
        return {
          kind: "assistant_delta",
          text: typeof obj.content === "string" ? obj.content : "",
        };
      }

      // Complete assistant message
      if (role === "assistant" && !obj.delta) {
        return {
          kind: "assistant_message",
          text: typeof obj.content === "string" ? obj.content : "",
        };
      }
    }

    // Handle tool_use events
    if (type === "tool_use") {
      return {
        kind: "assistant_message",
        text: "",
        toolUse: [
          {
            id: typeof obj.tool_id === "string" ? obj.tool_id : "",
            name: typeof obj.tool_name === "string" ? obj.tool_name : "",
            input: obj.parameters,
          },
        ],
      };
    }

    // Handle tool_result events
    if (type === "tool_result") {
      return {
        kind: "tool_result",
        toolUseId: typeof obj.tool_id === "string" ? obj.tool_id : "",
        isError: obj.status !== "success",
      };
    }

    // Handle final result
    if (type === "result") {
      const event: GeminiEvent = {
        kind: "result",
        text: "",
      };

      // Extract usage stats
      if (typeof obj.stats === "object" && obj.stats !== null) {
        const stats = obj.stats as Record<string, unknown>;
        event.usage = {
          inputTokens: typeof stats.input_tokens === "number" ? stats.input_tokens : undefined,
          outputTokens: typeof stats.output_tokens === "number" ? stats.output_tokens : undefined,
          totalTokens: typeof stats.total_tokens === "number" ? stats.total_tokens : undefined,
        };
      }

      // Map total_tokens if input/output aren't available
      if (
        event.usage &&
        !event.usage.inputTokens &&
        !event.usage.outputTokens &&
        event.usage.totalTokens
      ) {
        event.usage.inputTokens = event.usage.totalTokens;
      }

      return event;
    }

    // Handle error events
    if (type === "error") {
      return {
        kind: "error",
        message:
          typeof obj.message === "string"
            ? obj.message
            : typeof obj.error === "string"
              ? obj.error
              : "Unknown error",
      };
    }

    return null;
  }
}
