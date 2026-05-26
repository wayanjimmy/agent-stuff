# Sourcegraph Query Reference

## Query Syntax

### Filters

| Filter           | Example                          | Notes                        |
| ---------------- | -------------------------------- | ---------------------------- |
| **Repository**   | `repo:^github\.com/org/repo$`    | Regex anchor for exact match |
| **Exclude repo** | `-repo:fork`                     | Exclude matching repos       |
| **File**         | `file:\.ts$`, `file:internal/`   | Path regex                   |
| **Exclude file** | `-file:test`, `-file:_test\.go$` | Exclude matching files       |
| **Language**     | `lang:typescript`, `lang:go`     | Language filter              |
| **Content**      | `content:"exact phrase"`         | Literal match                |
| **Case**         | `case:yes`                       | Case-sensitive               |

### Boolean Operators

- `term1 AND term2` — both required
- `term1 OR term2` — either matches
- `term1 NOT term2` — exclude term2

## Best Practices

### ✅ DO: Use Simple Patterns

- Use short aliases over full package names (`sq.Select` not `squirrel.Select`)
- Always add `lang:` filter for faster, more relevant results
- Exclude vendor/test files: `-file:vendor -file:test -file:mock`

### ❌ DON'T: Complex Regex or OR Patterns

Separate complex OR queries into individual searches instead of using `sq.Select|sq.Insert|sq.Update lang:go` — they time out.

## Effective Search Patterns

### By Alias (Most Common)

```bash
./sourcegraph.ts --query "sq.Select lang:go -file:vendor"
./sourcegraph.ts --query "sq.Insert lang:go"
./sourcegraph.ts --query "sq.Update lang:go"
./sourcegraph.ts --query "sq.Delete lang:go"
```

### Conditionals

```bash
./sourcegraph.ts --query "sq.Eq lang:go -file:vendor"
./sourcegraph.ts --query "sq.Where lang:go"
./sourcegraph.ts --query "sq.And lang:go"
./sourcegraph.ts --query "sq.Or lang:go"
```

### Exact Phrases

```bash
./sourcegraph.ts --query '"useState" lang:typescript'
./sourcegraph.ts --query '"with open" lang:python -file:test'
```

### Repository-Specific

```bash
# Regex anchor for exact match
./sourcegraph.ts --query 'repo:^github\.com/kubernetes/kubernetes$ PodScheduler'

# Prefer broad first, then narrow
./sourcegraph.ts --query "kubernetes PodScheduler lang:go"
```

### Cross-Repository Patterns

```bash
./sourcegraph.ts --query "lang:go context.WithTimeout AND retry"
./sourcegraph.ts --query "lang:typescript redux middleware"
```

## Context Window Guide

| Value | Use Case                                               |
| ----- | ------------------------------------------------------ |
| 0     | Matching line only (minimal)                           |
| 1-2   | Quick preview                                          |
| 3-5   | **Sweet spot** — enough context for pattern recognition|
| 6-10  | Deep dive (may include noise)                          |

```bash
# Default (3)
./sourcegraph.ts --query "sq.Select lang:go"
# More context
./sourcegraph.ts --query "lang:typescript useEffect cleanup" --context-window 5
# Minimal
./sourcegraph.ts --query "flask route lang:python" --context-window 1
```