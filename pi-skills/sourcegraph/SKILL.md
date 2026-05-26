---
name: sourcegraph
description: Search public codebases with Sourcegraph to find real-world code examples, implementations, and usage patterns across millions of open-source repos. Use for code discovery, API research, and implementation reference.
---

# Sourcegraph Code Search

Search millions of open-source repos for code examples and patterns.

## Quick Start

```bash
# Basic search
./sourcegraph.ts --query "sq.Select lang:go -file:vendor"

# JSON via stdin
echo '{"query":"useState lang:typescript","count":10}' | ./sourcegraph.ts
```

## Parameters

| Param | Default | Range | Description |
|-------|---------|-------|-------------|
| `--query` \| `-q` | required | — | Search query |
| `--count` \| `-c` | 10 | 1–20 | Max results |
| `--context-window` | 3 | 0–10 | Context lines per match |
| `--timeout` \| `-t` | 30 | 1–120 | Timeout in seconds |

## Agent Invocation

```bash
deno run --allow-net=sourcegraph.com ./sourcegraph.ts --query "..." --count 5
```

Also accepts JSON on stdin for automation.

## Reference Files

| File | Contents |
|------|----------|
| [QUERY_REFERENCE.md](QUERY_REFERENCE.md) | Query syntax, filters, effective patterns, context window |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Error handling, output format, workflows, advanced usage |

## USE FOR

- Code discovery — finding real-world usage of functions, libraries, and APIs
- Implementation reference — how others solve common problems
- API research — exploring how functions/methods are used across projects
- Cross-repository analysis — comparing implementations across projects

## DO NOT USE FOR

- Private repository search (Sourcegraph.com indexes public repos only)
- General web search (use Tavily instead)
- Complex OR/regex patterns (prefer separate searches)
- Cloning or downloading repositories (read-only search)

## Key Tips

- **Add `lang:` filter** — relevant results
- **Exclude vendor/test** (`-file:vendor`) — reduce noise
- **Start broad, then narrow** — add filters as needed
- **Simple patterns** — OR/regex patterns time out