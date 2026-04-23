import { describe, expect, it, vi } from "vitest";
import {
  formatForLLM,
  formatSectionsCollapsed,
  formatWebCrawlForLLM,
  formatWebExtractForLLM,
  performCrawl,
  performExtract,
  performSearch,
  resultsToSections,
  throwIfAborted,
  truncateToCharBudget,
  type CrawlState,
  type ExtractState,
  type SearchDeps,
  type SearchState,
  type TavilySearchResult,
} from "../pi-extensions/web-search";

function makeResult(overrides: Partial<TavilySearchResult> = {}): TavilySearchResult {
  return {
    title: "Example",
    url: "https://example.com",
    content: "Some content",
    score: 0.9,
    ...overrides,
  };
}

function makeSearchState(overrides: Partial<SearchState> = {}): SearchState {
  return {
    status: "done",
    query: "test",
    results: [],
    ...overrides,
  };
}

function makeExtractState(overrides: Partial<ExtractState> = {}): ExtractState {
  return {
    status: "done",
    urls: ["https://example.com/docs"],
    results: [],
    failed: [],
    ...overrides,
  };
}

function makeCrawlState(overrides: Partial<CrawlState> = {}): CrawlState {
  return {
    status: "done",
    url: "https://example.com",
    results: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    getApiKey: () => "test-key",
    fetchFn: vi.fn(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resultsToSections", () => {
  it("returns empty array for no results and no answer", () => {
    expect(resultsToSections(makeSearchState())).toEqual([]);
  });

  it("includes summary section when answer is present", () => {
    const sections = resultsToSections(makeSearchState({ answer: "The answer" }));
    expect(sections[0]).toEqual({ title: "Summary", lines: ["The answer"] });
  });

  it("maps results to sections", () => {
    const results = [makeResult({ title: "A" }), makeResult({ title: "B" })];
    const sections = resultsToSections(makeSearchState({ results }));
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("A");
    expect(sections[1].title).toBe("B");
  });

  it("uses (untitled) for results with empty title", () => {
    const sections = resultsToSections(makeSearchState({ results: [makeResult({ title: "" })] }));
    expect(sections[0].title).toBe("(untitled)");
  });
});

describe("truncateToCharBudget", () => {
  it("leaves short text unchanged", () => {
    expect(truncateToCharBudget("short", 10)).toBe("short");
  });

  it("adds a truncation marker for long text", () => {
    const output = truncateToCharBudget("abcdefghijklmno", 10);
    expect(output).toBe("…[truncate");
  });
});

describe("formatForLLM", () => {
  it("returns 'No results found' when results are empty", () => {
    const output = formatForLLM(makeSearchState());
    expect(output).toContain("No results found");
  });

  it("includes summary when answer is present", () => {
    const output = formatForLLM(makeSearchState({ answer: "Summary text" }));
    expect(output).toContain("### Summary");
    expect(output).toContain("Summary text");
  });

  it("formats search results in score order", () => {
    const output = formatForLLM(
      makeSearchState({
        results: [
          makeResult({ title: "Lower", score: 0.2, url: "https://lower.test" }),
          makeResult({ title: "Higher", score: 0.9, url: "https://higher.test" }),
        ],
      }),
    );

    expect(output.indexOf("Higher")).toBeLessThan(output.indexOf("Lower"));
  });

  it("omits duplicated search content when a summary already covers it", () => {
    const shared = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
    const output = formatForLLM(
      makeSearchState({
        answer: `Summary: ${shared}`,
        results: [makeResult({ content: shared, title: "Covered" })],
      }),
    );

    expect(output).toContain("_Covered by summary; source retained._");
    expect(output).not.toContain(`**[Covered](https://example.com)**\n${shared}`);
  });

  it("truncates long search output to the configured budget", () => {
    const longContent = "a".repeat(1400);
    const results = Array.from({ length: 12 }, (_, index) =>
      makeResult({
        title: `Result ${index}`,
        url: `https://example.com/${index}`,
        content: longContent,
        score: 1 - index / 20,
      }),
    );

    const output = formatForLLM(makeSearchState({ results }));

    expect(output.length).toBeLessThanOrEqual(8000);
    expect(output).toContain("…[truncated]");
    expect(output).toContain("omitted to stay within context budget");
  });
});

describe("formatWebExtractForLLM", () => {
  it("truncates extracted content and total output", () => {
    const results = Array.from({ length: 3 }, (_, index) => ({
      url: `https://example.com/docs/${index}`,
      title: `Doc ${index}`,
      content: "b".repeat(5000),
    }));

    const output = formatWebExtractForLLM(makeExtractState({ results }));

    expect(output.length).toBeLessThanOrEqual(10000);
    expect(output).toContain("…[truncated]");
    expect(output).toContain("omitted to stay within context budget");
  });
});

describe("formatWebCrawlForLLM", () => {
  it("truncates crawled content and total output", () => {
    const results = Array.from({ length: 5 }, (_, index) => ({
      url: `https://example.com/page/${index}`,
      title: `Page ${index}`,
      content: "c".repeat(3000),
    }));

    const output = formatWebCrawlForLLM(makeCrawlState({ results }));

    expect(output.length).toBeLessThanOrEqual(8000);
    expect(output).toContain("…[truncated]");
    expect(output).toContain("omitted to stay within context budget");
  });
});

describe("formatSectionsCollapsed", () => {
  it("shows all sections when under maxSections", () => {
    const sections = [
      { title: "A", url: "https://a.com", lines: ["content a"] },
      { title: "B", lines: ["content b"] },
    ];
    const output = formatSectionsCollapsed(sections, 5, 1000);
    expect(output).toContain("**A**");
    expect(output).toContain("**B**");
    expect(output).not.toContain("more result");
  });

  it("truncates to maxSections and shows remaining count", () => {
    const sections = Array.from({ length: 5 }, (_, i) => ({
      title: `Item ${i}`,
      lines: ["content"],
    }));
    const output = formatSectionsCollapsed(sections, 2, 1000);
    expect(output).toContain("**Item 0**");
    expect(output).toContain("**Item 1**");
    expect(output).not.toContain("**Item 2**");
    expect(output).toContain("3 more results");
  });

  it("truncates long excerpts with ellipsis", () => {
    const sections = [{ title: "Long", lines: ["a".repeat(200)] }];
    const output = formatSectionsCollapsed(sections, 5, 50);
    expect(output).toContain(`${"a".repeat(50)}…`);
  });

  it("uses singular 'result' for 1 remaining", () => {
    const sections = [
      { title: "A", lines: ["a"] },
      { title: "B", lines: ["b"] },
    ];
    const output = formatSectionsCollapsed(sections, 1, 1000);
    expect(output).toContain("1 more result");
    expect(output).not.toContain("results");
  });
});

describe("throwIfAborted", () => {
  it("does nothing when signal is undefined", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it("does nothing when signal is not aborted", () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
  });

  it("throws AbortError when signal is aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow("Aborted");
  });
});

describe("performSearch", () => {
  it("returns error when objective is empty", async () => {
    const result = await performSearch({ objective: "" }, undefined, makeDeps());
    expect(result.status).toBe("error");
    expect(result.error).toContain("objective cannot be empty");
  });

  it("returns error when API key is missing", async () => {
    const deps = makeDeps({ getApiKey: () => undefined });
    const result = await performSearch({ objective: "test" }, undefined, deps);
    expect(result.status).toBe("error");
    expect(result.error).toContain("TAVILY_API_KEY");
  });

  it("returns done with results on successful response", async () => {
    const tavilyResponse = {
      query: "test query",
      answer: "An answer",
      results: [makeResult()],
      response_time: 0.5,
      request_id: "req-123",
    };
    const deps = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(tavilyResponse)),
    });

    const result = await performSearch({ objective: "test query" }, undefined, deps);
    expect(result.status).toBe("done");
    expect(result.answer).toBe("An answer");
    expect(result.results).toHaveLength(1);
    expect(result.responseTime).toBe(0.5);
  });

  it("returns error on non-ok HTTP response", async () => {
    const deps = makeDeps({
      fetchFn: vi.fn().mockResolvedValue(jsonResponse({ error: "Bad request" }, 400)),
    });

    const result = await performSearch({ objective: "test" }, undefined, deps);
    expect(result.status).toBe("error");
    expect(result.error).toBe("Bad request");
  });

  it("returns aborted when fetch is aborted mid-request", async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      fetchFn: vi.fn().mockImplementation(() => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    });

    const result = await performSearch({ objective: "test" }, controller.signal, deps);
    expect(result.status).toBe("aborted");
  });

  it("returns network error on fetch failure", async () => {
    const deps = makeDeps({
      fetchFn: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });

    const result = await performSearch({ objective: "test" }, undefined, deps);
    expect(result.status).toBe("error");
    expect(result.error).toContain("Network error");
    expect(result.error).toContain("Connection refused");
  });

  it("sends the leaner default search body to Tavily", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ query: "q", results: [], response_time: 0.1, request_id: "req-123" }),
      );
    const deps = makeDeps({ fetchFn });

    await performSearch({ objective: "my goal", search_queries: ["kw1"] }, undefined, deps);

    const call = fetchFn.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.query).toBe("my goal");
    expect(body.max_results).toBe(5);
    expect(body.include_answer).toBe(false);
    expect(body.search_queries).toEqual(["kw1"]);
    expect(body).not.toHaveProperty("topic");
    expect(call[1].headers.Authorization).toBe("Bearer test-key");
  });
});

describe("performExtract", () => {
  it("builds extract requests without removed schema fields", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [{ url: "https://example.com/docs", raw_content: "Extracted text" }],
        failed: [],
        response_time: 0.2,
        request_id: "req-extract",
      }),
    );
    const deps = makeDeps({ fetchFn });

    await performExtract(
      { urls: ["https://example.com/docs"], query: "auth", timeout: 30 },
      undefined,
      deps,
    );

    const call = fetchFn.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.query).toBe("auth");
    expect(body.timeout).toBe(30);
    expect(body).not.toHaveProperty("chunks_per_source");
    expect(body).not.toHaveProperty("include_images");
  });
});

describe("performCrawl", () => {
  it("uses the lower default crawl limit and omits removed fields", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ results: [], response_time: 0.3, request_id: "req-crawl" }),
      );
    const deps = makeDeps({ fetchFn });

    await performCrawl({ url: "https://example.com/docs" }, undefined, deps);

    const call = fetchFn.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.url).toBe("https://example.com/docs");
    expect(body.limit).toBe(10);
    expect(body).not.toHaveProperty("chunks_per_source");
    expect(body).not.toHaveProperty("include_images");
  });
});
