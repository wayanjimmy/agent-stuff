---
name: sourcegraph
description: Search public code across GitHub repositories via Sourcegraph GraphQL API. Use for finding code examples, implementations, and patterns across open source projects.
---

# Sourcegraph Code Search

Search code across public repositories using Sourcegraph's GraphQL API.

## Setup

Requires Deno runtime. No additional setup needed.

## Usage

Pass JSON to stdin with the search parameters:

```bash
echo '{"query":"lang:go context.WithTimeout","count":5}' | deno run --quiet --allow-net=sourcegraph.com {baseDir}/sourcegraph.ts
```

Or use command-line flags:

```bash
deno run --quiet --allow-net=sourcegraph.com {baseDir}/sourcegraph.ts --query "file:.go context.WithTimeout" --count 10
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | (required) | Sourcegraph search query |
| `count` | number | 10 | Results to return (1-20) |
| `context_window` | number | 3 | Line matches per file (0-10) |
| `timeout` | number | 30 | Timeout in seconds (1-120) |

## Query Syntax

### Basic Patterns
- `fmt.Println` - exact matches
- `file:.go fmt.Println` - limit to Go files
- `lang:typescript useState` - limit by language
- `repo:^github\.com/golang/go$` - specific repository

### Key Filters
- **Repository**: `repo:name`, `-repo:exclude`, `fork:yes`
- **File**: `file:\.js$`, `file:internal/`, `-file:test`
- **Content**: `content:"exact"`, `case:yes`
- **Type**: `type:symbol`, `type:file`, `type:diff`

### Boolean Operators
- `term1 AND term2` - both terms
- `term1 OR term2` - either term
- `term1 NOT term2` - exclude term2

## Examples

Find Go code using context.WithTimeout:
```bash
echo '{"query":"file:.go context.WithTimeout"}' | deno run --quiet --allow-net=sourcegraph.com {baseDir}/sourcegraph.ts
```

Search TypeScript React hooks:
```bash
echo '{"query":"lang:typescript useState type:symbol","count":5}' | deno run --quiet --allow-net=sourcegraph.com {baseDir}/sourcegraph.ts
```

Find Kubernetes pod-related files:
```bash
echo '{"query":"repo:^github\\.com/kubernetes/kubernetes$ pod list type:file"}' | deno run --quiet --allow-net=sourcegraph.com {baseDir}/sourcegraph.ts
```

## Output Format

```
Found 42 matches in 15 files (123ms)

## github.com/org/repo - path/to/file.go
[View on Sourcegraph](https://sourcegraph.com/...)

```
12: matched line content
13: next line
```
```

## When to Use

- Finding real-world code examples and implementations
- Discovering how libraries are used in practice
- Searching for specific patterns across open source
- Learning from existing codebases

## Important: Do NOT Clone Repositories

**Never clone repositories to examine code.** Sourcegraph provides all the context you need:
- Use the "View on Sourcegraph" links to read full files
- Run additional searches to explore related code
- Increase `context_window` parameter to see more surrounding lines

Cloning is unnecessary, slow, and wastes disk space. Sourcegraph is your read-only code browser.
