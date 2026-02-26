import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { Static } from "@sinclair/typebox";
import type { WebSearchParams } from "./web-search-params.ts";

const TAVILY_API_URL = "https://api.tavily.com/search";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string;
  score: number;
}

export interface TavilyResponse {
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
}

async function getApiKey(): Promise<string | undefined> {
  // Check environment variable first
  const envKey = process.env.TAVILY_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Check config file
  const configPaths = [
    join(homedir(), ".pi", "extensions", "pi-web-search.json"),
    join(process.cwd(), ".pi", "extensions", "pi-web-search.json"),
  ];

  for (const configPath of configPaths) {
    try {
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      if (config.apiKey) {
        return config.apiKey;
      }
    } catch {
      // Config file doesn't exist or is invalid, continue to next
    }
  }

  return undefined;
}

function truncateHead(
  content: string,
  maxBytes: number = 50000,
  maxLines: number = 2000
): { content: string; truncated: boolean; totalLines: number; totalBytes: number } {
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

export async function performSearch(
  params: Static<typeof WebSearchParams>,
  state: SearchState,
  signal?: AbortSignal
): Promise<SearchState> {
  const apiKey = await getApiKey();

  if (!apiKey) {
    return {
      ...state,
      status: "error",
      error:
        "Tavily API key not found. Set TAVILY_API_KEY environment variable or use /web-search-key command to configure.",
      endedAt: Date.now(),
    };
  }

  const requestBody = {
    api_key: apiKey,
    query: params.query,
    search_depth: params.search_depth ?? "basic",
    max_results: params.max_results ?? 10,
    include_answer: params.include_answer ?? true,
    include_raw_content: params.include_raw_content ?? false,
    days: params.days ?? 3,
    topic: params.topic ?? "general",
  };

  try {
    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = (await response.json()) as TavilyError;
        errorMessage =
          errorData.detail?.error || errorData.error || errorMessage;
      } catch {
        // Use default error message
      }

      if (response.status === 401) {
        errorMessage = "Invalid API key. Please check your Tavily API key.";
      } else if (response.status === 429) {
        errorMessage = "Rate limit exceeded. Please wait before trying again.";
      }

      return {
        ...state,
        status: "error",
        error: errorMessage,
        endedAt: Date.now(),
      };
    }

    const data = (await response.json()) as TavilyResponse;

    // Truncate results if needed
    const processedResults = data.results.map((result) => {
      const contentTruncation = truncateHead(result.content);
      const processed: TavilyResult = {
        ...result,
        content: contentTruncation.content,
      };

      if (result.raw_content) {
        const rawTruncation = truncateHead(result.raw_content);
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
      endedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          ...state,
          status: "aborted",
          error: "Search was cancelled.",
          endedAt: Date.now(),
        };
      }

      return {
        ...state,
        status: "error",
        error: `Network error: ${error.message}`,
        endedAt: Date.now(),
      };
    }

    return {
      ...state,
      status: "error",
      error: "An unexpected error occurred during the search.",
      endedAt: Date.now(),
    };
  }
}
