import { describe, it, expect, vi } from "vitest";
import {
	performSearch,
	formatForLLM,
	resultsToSections,
	formatSectionsCollapsed,
	throwIfAborted,
	type SearchState,
	type TavilyResult,
	type SearchDeps,
} from "../pi-extensions/web-search";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<TavilyResult> = {}): TavilyResult {
	return {
		title: "Example",
		url: "https://example.com",
		content: "Some content",
		score: 0.9,
		...overrides,
	};
}

function makeState(overrides: Partial<SearchState> = {}): SearchState {
	return {
		status: "done",
		query: "test",
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

// ---------------------------------------------------------------------------
// resultsToSections
// ---------------------------------------------------------------------------

describe("resultsToSections", () => {
	it("returns empty array for no results and no answer", () => {
		expect(resultsToSections(makeState())).toEqual([]);
	});

	it("includes summary section when answer is present", () => {
		const sections = resultsToSections(makeState({ answer: "The answer" }));
		expect(sections[0]).toEqual({ title: "Summary", lines: ["The answer"] });
	});

	it("maps results to sections", () => {
		const results = [makeResult({ title: "A" }), makeResult({ title: "B" })];
		const sections = resultsToSections(makeState({ results }));
		expect(sections).toHaveLength(2);
		expect(sections[0].title).toBe("A");
		expect(sections[1].title).toBe("B");
	});

	it("uses (untitled) for results with empty title", () => {
		const sections = resultsToSections(makeState({ results: [makeResult({ title: "" })] }));
		expect(sections[0].title).toBe("(untitled)");
	});
});

// ---------------------------------------------------------------------------
// formatForLLM
// ---------------------------------------------------------------------------

describe("formatForLLM", () => {
	it("returns 'No results found' when results are empty", () => {
		const output = formatForLLM(makeState());
		expect(output).toContain("No results found");
	});

	it("includes summary when answer is present", () => {
		const output = formatForLLM(makeState({ answer: "Summary text" }));
		expect(output).toContain("### Summary");
		expect(output).toContain("Summary text");
	});

	it("formats results as markdown links", () => {
		const results = [makeResult({ title: "Foo", url: "https://foo.com", content: "bar" })];
		const output = formatForLLM(makeState({ results }));
		expect(output).toContain("**[Foo](https://foo.com)**");
		expect(output).toContain("bar");
		expect(output).toContain("1 found");
	});
});

// ---------------------------------------------------------------------------
// formatSectionsCollapsed
// ---------------------------------------------------------------------------

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
		expect(output).toContain("a".repeat(50) + "…");
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

// ---------------------------------------------------------------------------
// throwIfAborted
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// performSearch
// ---------------------------------------------------------------------------

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

	it("falls back to query param when objective is empty", async () => {
		const deps = makeDeps({ getApiKey: () => undefined });
		const result = await performSearch({ objective: "", query: "fallback" }, undefined, deps);
		expect(result.query).toBe("fallback");
	});

	it("returns done with results on successful response", async () => {
		const tavilyResponse = {
			query: "test query",
			answer: "An answer",
			results: [makeResult()],
			response_time: 0.5,
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

	it("sends correct body to Tavily API", async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({ query: "q", results: [], response_time: 0.1 }),
		);
		const deps = makeDeps({ fetchFn });

		await performSearch(
			{ objective: "my goal", max_results: 5, topic: "news", search_queries: ["kw1"] },
			undefined,
			deps,
		);

		const call = fetchFn.mock.calls[0];
		const body = JSON.parse(call[1].body);
		expect(body.query).toBe("my goal");
		expect(body.max_results).toBe(5);
		expect(body.topic).toBe("news");
		expect(body.search_queries).toEqual(["kw1"]);
		expect(body.api_key).toBe("test-key");
	});
});
