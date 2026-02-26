import type { WebSearchParamsType } from "./web-search-params.js";
import { createApiKeyManager } from "./api-key-manager.js";

const TAVILY_API_URL = "https://api.tavily.com/search";

/** Maximum content size in bytes before truncation (50KB) */
const MAX_CONTENT_BYTES = 50 * 1024;

/** Maximum number of lines before truncation */
const MAX_CONTENT_LINES = 2000;

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
  score: number;
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time: number;
}

interface TavilyError {
  detail?: {
    error?: string;
  };
  error?: string;
}

export interface SearchState {
  status: "idle" | "running" | "done" | "error" | "aborted";
  query: string;
  answer?: string;
  results: TavilyResult[];
  responseTime?: number;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  keysUsed?: number;
}

interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  totalBytes: number;
}

/**
 * Truncates content to stay within byte and line limits.
 * Preserves the end of the content (head truncation) to keep the most relevant parts.
 */
function truncateHead(content: string, maxBytes: number, maxLines: number): TruncationResult {
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const totalLines = content.split("\n").length;

  let truncatedContent = content;
  let truncated = false;

  // Truncate by bytes
  if (totalBytes > maxBytes) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode(content);
    truncatedContent = decoder.decode(bytes.slice(0, maxBytes));
    truncated = true;
  }

  // Truncate by lines
  const lines = truncatedContent.split("\n");
  if (lines.length > maxLines) {
    truncatedContent = lines.slice(0, maxLines).join("\n");
    truncated = true;
  }

  return {
    content: truncatedContent,
    truncated,
    totalLines,
    totalBytes,
  };
}

/**
 * Performs a web search using the Tavily API with automatic key rotation.
 *
 * @param params - Search parameters validated by TypeBox
 * @param state - Initial search state to be updated
 * @param signal - Optional AbortSignal for cancellation support
 * @returns Updated search state with results or error information
 */
export function performSearch(
  params: WebSearchParamsType,
  state: SearchState,
  signal?: AbortSignal
): Promise<SearchState> {
  const keyManager = createApiKeyManager();

  if (!keyManager) {
    return Promise.resolve({
      ...state,
      status: "error",
      error:
        "No API keys found. Set TAVILY_API_KEY or TAVILY_API_KEYS environment variable",
      endedAt: Date.now(),
    });
  }

  const requestBodyBase = {
    query: params.query,
    search_depth: params.search_depth ?? "basic",
    max_results: params.max_results ?? 10,
    include_answer: params.include_answer ?? true,
    include_raw_content: params.include_raw_content ?? false,
    days: params.days ?? 3,
    topic: params.topic ?? "general",
  };

  let lastError: string | undefined;
  let keysAttempted = 0;

  // Try each available key until one succeeds
  async function trySearch(): Promise<SearchState> {
    while (keysAttempted < keyManager.getTotalKeyCount()) {
      const apiKey = keyManager.getNextKey();
      if (!apiKey) {
        break;
      }

      keysAttempted++;

      try {
        const response = await fetch(TAVILY_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...requestBodyBase, api_key: apiKey }),
          signal,
        });

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = (await response.json()) as TavilyError;
            errorMessage = errorData.detail?.error || errorData.error || errorMessage;
          } catch {
            // Use default error message
          }

          if (response.status === 401) {
            errorMessage = "Invalid API key";
          } else if (response.status === 429) {
            errorMessage = "Rate limit exceeded";
          }

          // Report failure and check if we should retry with another key
          const shouldRetry = keyManager.reportFailure(apiKey, response.status);
          if (shouldRetry) {
            lastError = errorMessage;
            continue; // Try next key
          }

          // No more keys to try
          return {
            ...state,
            status: "error",
            error: errorMessage,
            keysUsed: keysAttempted,
            endedAt: Date.now(),
          };
        }

        // Success - report it and process results
        keyManager.reportSuccess(apiKey);

        const data = (await response.json()) as TavilyResponse;

        // Truncate results if needed
        const processedResults = data.results.map((result) => {
          const contentTruncation = truncateHead(result.content, MAX_CONTENT_BYTES, MAX_CONTENT_LINES);
          const processed: TavilyResult = {
            ...result,
            content: contentTruncation.content,
          };

          if (result.raw_content) {
            const rawTruncation = truncateHead(result.raw_content, MAX_CONTENT_BYTES, MAX_CONTENT_LINES);
            processed.raw_content = rawTruncation.content;
          }

          return processed;
        });

        return {
          ...state,
          status: "done",
          query: data.query,
          answer: data.answer,
          results: processedResults,
          responseTime: data.response_time,
          keysUsed: keysAttempted,
          endedAt: Date.now(),
        };
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === "AbortError") {
            return {
              ...state,
              status: "aborted",
              error: "Search was cancelled",
              keysUsed: keysAttempted,
              endedAt: Date.now(),
            };
          }

          // Report network failure and check if we should retry
          const shouldRetry = keyManager.reportFailure(apiKey);
          if (shouldRetry) {
            lastError = `Network error: ${error.message}`;
            continue; // Try next key
          }

          return {
            ...state,
            status: "error",
            error: `Network error: ${error.message}`,
            keysUsed: keysAttempted,
            endedAt: Date.now(),
          };
        }

        // Unexpected error
        return {
          ...state,
          status: "error",
          error: "An unexpected error occurred during the search",
          keysUsed: keysAttempted,
          endedAt: Date.now(),
        };
      }
    }

    // All keys exhausted
    return {
      ...state,
      status: "error",
      error: lastError || "All API keys exhausted or unavailable",
      keysUsed: keysAttempted,
      endedAt: Date.now(),
    };
  }

  return trySearch();
}
