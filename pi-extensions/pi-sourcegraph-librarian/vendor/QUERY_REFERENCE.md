# Sourcegraph Query Syntax — Quick Reference

## Filters

| Filter | Example | Notes |
|--------|---------|-------|
| **Repository** | `repo:^github\.com/org/repo$` | Regex anchor for exact match |
| **Exclude repo** | `-repo:fork` | Exclude matching repos |
| **File** | `file:\.ts$`, `file:internal/` | Path regex |
| **Exclude file** | `-file:test`, `-file:_test\.go$` | |
| **Language** | `lang:typescript`, `lang:go` | |
| **Content** | `content:"exact phrase"` | Literal match |
| **Case** | `case:yes` | Case-sensitive |
| **Type** | `type:symbol`, `type:file`, `type:diff` | |
| **Fork** | `fork:yes` | Include forks |

## Boolean Operators

- `term1 AND term2` — both required
- `term1 OR term2` — either matches
- `term1 NOT term2` — exclude term2

## CLI Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `--query` | (required) | — | Sourcegraph search query |
| `--count` | 10 | 1–20 | Max results |
| `--context-window` | 3 | 0–10 | Line matches per file |
| `--timeout` | 30 | 1–120 | Timeout in seconds |
| `--pattern-type` | keyword | keyword/literal/regexp/structural | Search pattern type |

## Examples

```bash
# Specific repo, Go files (default keyword pattern type)
deno run ... --query "repo:^github\.com/kubernetes/kubernetes$ file:\.go$ PodScheduler" --count 10

# Cross-repo pattern search (default keyword pattern type)
deno run ... --query "lang:go context.WithTimeout AND retry" --count 15

# TypeScript React hooks with symbol search
deno run ... --query "lang:typescript useState type:symbol" --count 5

# Regex pattern search for function definitions
deno run ... --query "repo:^github\.com/org/repo$ lang:typescript" --pattern-type regexp --count 10

# Exclude tests
deno run ... --query "repo:^github\.com/org/repo$ file:\.ts$ -file:test AuthMiddleware"
```

## Important

- **Never clone repositories.** Use search + `--context-window` for context.
- Increase `--context-window` (up to 10) to see more surrounding lines.
- Use `[View on Sourcegraph](...)` links from output to cite evidence.
