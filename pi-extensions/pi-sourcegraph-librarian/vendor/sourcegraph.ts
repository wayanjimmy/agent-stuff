#!/usr/bin/env -S deno run --quiet --allow-net=sourcegraph.com

interface Params {
	query: string;
	count?: number;
	context_window?: number;
	timeout?: number;
	pattern_type?: "keyword" | "literal" | "regexp" | "structural";
}

interface LineMatch {
	line: string;
	lineNumber: number;
}

interface SymbolInfo {
	name: string;
	kind: string;
	url: string;
	containerName?: string;
}

interface SearchMatch {
	repo: string;
	path: string;
	url: string;
	lineMatches: LineMatch[];
	symbols?: SymbolInfo[];
}

interface SearchResult {
	query: string;
	matches: SearchMatch[];
	stats: { matchCount: number; resultCount: number; elapsed: string };
}

const SOURCEGRAPH_API_URL = "https://sourcegraph.com/.api/graphql";

const SEARCH_QUERY = `
query Search($query: String!, $patternType: SearchPatternType!) {
  search(query: $query, version: V3, patternType: $patternType) {
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
        ... on SymbolMatch {
          repository { name }
          file { path url }
          symbols {
            name
            kind
            url
            containerName
          }
        }
        ... on CommitDiff {
          repository { name }
          commit { url }
          file { path }
          diff {
            newPath
            oldPath
            hunks {
              body
              oldLine
              oldSpanLines
              newLine
              newSpanLines
            }
          }
        }
      }
    }
  }
}
`;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

async function searchSourcegraph(
	query: string,
	count: number,
	contextWindow: number,
	timeoutMs: number,
	patternType: "keyword" | "literal" | "regexp" | "structural" = "keyword"
): Promise<SearchResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(SOURCEGRAPH_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "pi-sourcegraph/1.0",
			},
			body: JSON.stringify({
				query: SEARCH_QUERY,
				variables: {
					query: `${query} count:${count}`,
					patternType,
				},
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const json = await response.json();

		if (json.errors?.length) {
			throw new Error(
				json.errors.map((e: { message: string }) => e.message).join("; ")
			);
		}

		const results = json.data?.search?.results;
		if (!results) {
			return {
				query,
				matches: [],
				stats: { matchCount: 0, resultCount: 0, elapsed: "0ms" },
			};
		}

		const matches: SearchMatch[] = [];
		for (const result of results.results || []) {
			if (result.__typename === "FileMatch") {
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
			} else if (result.__typename === "SymbolMatch") {
				if (!result.repository || !result.file || !result.symbols) continue;

				const symbols: SymbolInfo[] = result.symbols.map((s: any) => ({
					name: s.name,
					kind: s.kind,
					url: s.url,
					containerName: s.containerName,
				}));

				matches.push({
					repo: result.repository.name,
					path: result.file.path,
					url: `https://sourcegraph.com${result.file.url}`,
					lineMatches: [],
					symbols,
				});
			} else if (result.__typename === "CommitDiff") {
				if (!result.repository || !result.commit || !result.file) continue;

				const diffBody = result.diff?.hunks
					?.map((h: any) => h.body)
					.filter((b: string) => b)
					.join("\n") || "(diff content)";

				matches.push({
					repo: result.repository.name,
					path: result.diff?.newPath || result.diff?.oldPath || result.file.path,
					url: result.commit.url,
					lineMatches: [{ line: diffBody, lineNumber: 0 }],
					symbols: undefined,
				});
			}
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

		// If this is a symbol match, show symbols
		if (match.symbols && match.symbols.length > 0) {
			lines.push("**Symbols:**");
			for (const sym of match.symbols) {
				const container = sym.containerName ? ` (${sym.containerName})` : "";
				lines.push(`- \`${sym.name}\` [${sym.kind}]${container}`);
			}
			lines.push("");
		}

		// Show line matches if present
		if (match.lineMatches.length > 0) {
			lines.push("```");
			for (const lm of match.lineMatches) {
				const prefix = lm.lineNumber === 0 ? "" : `${lm.lineNumber}: `;
				lines.push(`${prefix}${lm.line}`);
			}
			lines.push("```");
		}
		lines.push("");
	}

	return lines.join("\n");
}

function parseArgs(args: string[]): Params {
	const params: Params = { query: "" };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1];

		switch (arg) {
			case "--query":
			case "-q":
				params.query = next || "";
				i++;
				break;
			case "--count":
			case "-c":
				params.count = parseInt(next, 10);
				i++;
				break;
			case "--context-window":
			case "--context_window":
				params.context_window = parseInt(next, 10);
				i++;
				break;
			case "--timeout":
			case "-t":
				params.timeout = parseInt(next, 10);
				i++;
				break;
			case "--pattern-type":
			case "--pattern_type":
				if (["keyword", "literal", "regexp", "structural"].includes(next)) {
					params.pattern_type = next as "keyword" | "literal" | "regexp" | "structural";
				}
				i++;
				break;
		}
	}

	return params;
}

async function readStdin(): Promise<string> {
	const decoder = new TextDecoder();
	const chunks: string[] = [];

	for await (const chunk of Deno.stdin.readable) {
		chunks.push(decoder.decode(chunk));
	}

	return chunks.join("");
}

async function main() {
	let params: Params;

	if (Deno.args.length > 0) {
		params = parseArgs(Deno.args);
	} else {
		try {
			const input = await readStdin();
			params = JSON.parse(input.trim());
		} catch {
			console.error("Error: provide JSON on stdin or use --query flag");
			Deno.exit(1);
		}
	}

	if (!params.query?.trim()) {
		console.error("Error: query parameter is required");
		Deno.exit(1);
	}

	const count = clamp(params.count ?? 10, 1, 20);
	const contextWindow = clamp(params.context_window ?? 3, 0, 10);
	const timeout = clamp(params.timeout ?? 30, 1, 120);
	const timeoutMs = timeout * 1000;
	const patternType = params.pattern_type ?? "keyword";

	try {
		const result = await searchSourcegraph(
			params.query.trim(),
			count,
			contextWindow,
			timeoutMs,
			patternType
		);
		console.log(formatResult(result));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const isTimeout = message.includes("abort") || message.includes("timeout");

		if (isTimeout) {
			console.error(`Search timed out after ${timeout}s. Try a more specific query.`);
		} else {
			console.error(`Search failed: ${message}`);
		}
		Deno.exit(1);
	}
}

main();
