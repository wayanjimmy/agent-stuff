import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

const SourcegraphToolParamsSchema = Type.Object({
	query: Type.String({ description: "Code search query (Sourcegraph syntax)" }),
	count: Type.Optional(
		Type.Number({
			description: "Number of results to return (1-20, default 10)",
			minimum: 1,
			maximum: 20,
			default: 10,
		})
	),
	context_window: Type.Optional(
		Type.Number({
			description: "Lines of context around matches (default 3)",
			minimum: 0,
			maximum: 10,
			default: 3,
		})
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Timeout in seconds (max 120, default 30)",
			minimum: 1,
			maximum: 120,
			default: 30,
		})
	),
});

type SourcegraphToolParams = Static<typeof SourcegraphToolParamsSchema>;

interface LineMatch {
	line: string;
	lineNumber: number;
}

interface SearchMatch {
	repo: string;
	path: string;
	url: string;
	lineMatches: LineMatch[];
}

interface SearchResult {
	query: string;
	matches: SearchMatch[];
	stats: { matchCount: number; resultCount: number; elapsed: string };
}

const SOURCEGRAPH_API_URL = "https://sourcegraph.com/.api/graphql";

const SEARCH_QUERY = `
query Search($query: String!) {
  search(query: $query, version: V3, patternType: keyword) {
    results {
      matchCount
      resultCount
      elapsedMilliseconds
      results {
        __typename
        ... on FileMatch {
          repository { name }
          file { path url }
          lineMatches { preview lineNumber }
        }
      }
    }
  }
}
`;

async function searchSourcegraph(
	query: string,
	count: number,
	contextWindow: number,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<SearchResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	if (signal) {
		signal.addEventListener("abort", () => controller.abort(), { once: true });
	}

	try {
		const response = await fetch(SOURCEGRAPH_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "pi-sourcegraph/1.0",
			},
			body: JSON.stringify({
				query: SEARCH_QUERY,
				variables: { query: `${query} count:${count}` },
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const json = await response.json();

		if (json.errors?.length) {
			throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
		}

		const results = json.data?.search?.results;
		if (!results) {
			return { query, matches: [], stats: { matchCount: 0, resultCount: 0, elapsed: "0ms" } };
		}

		const matches: SearchMatch[] = [];
		for (const result of results.results || []) {
			if (result.__typename !== "FileMatch") continue;
			if (!result.repository || !result.file || !result.lineMatches) continue;

			const lineMatches: LineMatch[] = result.lineMatches
				.slice(0, contextWindow > 0 ? contextWindow * 2 + 1 : 5)
				.map((lm: { preview: string; lineNumber: number }) => ({
					line: lm.preview,
					lineNumber: lm.lineNumber,
				}));

			matches.push({
				repo: result.repository.name,
				path: result.file.path,
				url: `https://sourcegraph.com${result.file.url}`,
				lineMatches,
			});
		}

		return {
			query,
			matches,
			stats: {
				matchCount: results.matchCount ?? 0,
				resultCount: results.resultCount ?? 0,
				elapsed: `${results.elapsedMilliseconds ?? 0}ms`,
			},
		};
	} finally {
		clearTimeout(timeout);
	}
}

function formatResult(result: SearchResult): string {
	if (result.matches.length === 0) {
		return `No results found for query: "${result.query}"`;
	}

	const lines: string[] = [
		`Found ${result.stats.matchCount} matches in ${result.stats.resultCount} files (${result.stats.elapsed})`,
		"",
	];

	for (const match of result.matches) {
		lines.push(`## ${match.repo} - ${match.path}`);
		lines.push(`[View on Sourcegraph](${match.url})`);
		lines.push("");
		lines.push("```");
		for (const lm of match.lineMatches) {
			lines.push(`${lm.lineNumber}: ${lm.line}`);
		}
		lines.push("```");
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Sourcegraph extension for Pi.
 * Provides a tool to search public code across GitHub repositories via Sourcegraph.
 */
export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "sourcegraph",
		label: "Sourcegraph Search",
		description: `Search code across public repositories using Sourcegraph's GraphQL API.

<basic_syntax>
- "fmt.Println" - exact matches
- "file:.go fmt.Println" - limit to Go files
- "repo:^github\\.com/golang/go$ fmt.Println" - specific repos
- "lang:go fmt.Println" - limit to Go code
- "fmt.Println AND log.Fatal" - combined terms
- "fmt\\.(Print|Printf|Println)" - regex patterns
- "\\"exact phrase\\"" - exact phrase matching
- "-file:test" or "-repo:forks" - exclude matches
</basic_syntax>

<key_filters>
Repository: repo:name, repo:^exact$, repo:org/repo@branch, -repo:exclude, fork:yes, archived:yes, visibility:public
File: file:\\.js$, file:internal/, -file:test, file:has.content(text)
Content: content:"exact", -content:"unwanted", case:yes
Type: type:symbol, type:file, type:path, type:diff, type:commit
Time: after:"1 month ago", before:"2023-01-01", author:name, message:"fix"
Result: select:repo, select:file, select:content, count:100, timeout:30s
</key_filters>

<examples>
- "file:.go context.WithTimeout" - Go code using context.WithTimeout
- "lang:typescript useState type:symbol" - TypeScript React useState hooks
- "repo:^github\\.com/kubernetes/kubernetes$ pod list type:file" - Kubernetes pod files
- "file:Dockerfile (alpine OR ubuntu) -content:alpine:latest" - Dockerfiles with base images
</examples>

<boolean_operators>
- "term1 AND term2" - both terms
- "term1 OR term2" - either term
- "term1 NOT term2" - term1 but not term2
- "term1 and (term2 or term3)" - grouping with parentheses
</boolean_operators>

<tips>
- Use specific file extensions to narrow results
- Add repo: filters for targeted searches
- Use type:symbol for function/method definitions
- Use type:file to find relevant files
- Only searches public repositories, max 20 results per query
</tips>`,
		parameters: SourcegraphToolParamsSchema,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { query, count = 10, context_window = 3, timeout = 30 } =
				params as SourcegraphToolParams;

			if (!query?.trim()) {
				return {
					content: [{ type: "text", text: "Error: query parameter is required" }],
					isError: true,
					details: null,
				};
			}

			const clampedCount = Math.max(1, Math.min(20, count));
			const clampedContext = Math.max(0, Math.min(10, context_window));
			const timeoutMs = Math.max(1, Math.min(120, timeout)) * 1000;

			try {
				const result = await searchSourcegraph(
					query.trim(),
					clampedCount,
					clampedContext,
					timeoutMs,
					signal
				);

				return {
					content: [{ type: "text", text: formatResult(result) }],
					details: result,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const isTimeout = message.includes("abort") || message.includes("timeout");

				return {
					content: [
						{
							type: "text",
							text: isTimeout
								? `Search timed out after ${timeout}s. Try a more specific query.`
								: `Search failed: ${message}`,
						},
					],
					isError: true,
					details: null,
				};
			}
		},
	});
}
