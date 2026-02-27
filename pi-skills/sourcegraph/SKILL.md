---
name: sourcegraph
description: Search public codebases using Sourcegraph to find implementations, patterns, and usage examples. Use when you need code examples, want to see how libraries are used, or research implementation patterns.
---

# Sourcegraph Code Search

Search millions of open-source repositories to find real-world code examples, implementation patterns, and usage documentation.

## Quick Start

```bash
# Basic search
./sourcegraph.ts --query "sq.Select lang:go -file:vendor"

# With custom parameters
./sourcegraph.ts --query "useState lang:typescript" --count 15 --context-window 5

# From stdin (JSON)
echo '{"query":"lang:go rate limiting","count":10}' | ./sourcegraph.ts
```

## Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `--query` \| `-q` | (required) | — | Sourcegraph search query |
| `--count` \| `-c` | 10 | 1–20 | Maximum number of results to return |
| `--context-window` | 3 | 0–10 | Number of surrounding lines per match |
| `--timeout` \| `-t` | 30 | 1–120 | Timeout in seconds |

## Query Syntax

### Filters

| Filter | Example | Notes |
|--------|---------|-------|
| **Repository** | `repo:^github\.com/org/repo$` | Regex anchor for exact match |
| **Exclude repo** | `-repo:fork` | Exclude matching repos |
| **File** | `file:\.ts$`, `file:internal/` | Path regex |
| **Exclude file** | `-file:test`, `-file:_test\.go$` | Exclude matching files |
| **Language** | `lang:typescript`, `lang:go` | Language filter |
| **Content** | `content:"exact phrase"` | Literal match |
| **Case** | `case:yes` | Case-sensitive |

### Boolean Operators

- `term1 AND term2` — both required
- `term1 OR term2` — either matches
- `term1 NOT term2` — exclude term2

## Best Practices

### ✅ DO: Use Simple Patterns

```bash
# Good: Simple alias search
./sourcegraph.ts --query "sq.Select lang:go -file:vendor"

# Good: Direct pattern
./sourcegraph.ts --query "useState lang:typescript -file:test"
```

### ❌ DON'T: Complex Regex

```bash
# Bad: Complex OR times out
./sourcegraph.ts --query "sq.Select|sq.Insert|sq.Update lang:go"

# Good: Search separately instead
./sourcegraph.ts --query "sq.Select lang:go"
./sourcegraph.ts --query "sq.Insert lang:go"
```

### ✅ DO: Use Common Aliases

```bash
# Use short aliases, not full package names
./sourcegraph.ts --query "sq.Select lang:go"        # Good
./sourcegraph.ts --query "squirrel.Select lang:go"  # Less common
```

### ✅ DO: Exclude Noise

```bash
# Always exclude test/vendor files for cleaner results
./sourcegraph.ts --query "sq.Select lang:go -file:vendor"
./sourcegraph.ts --query "useState lang:typescript -file:test"
./sourcegraph.ts --query "lang:go -file:_test\.go$"
```

### ✅ DO: Always Add Language Filter

```bash
# Include language filter for faster, more relevant results
./sourcegraph.ts --query "sq.Select lang:go"
./sourcegraph.ts --query "useState lang:typescript"
./sourcegraph.ts --query "flask route lang:python"
```

## Effective Search Patterns

### By Alias (Most Common)

```bash
# Find usage by import alias
./sourcegraph.ts --query "sq.Select lang:go -file:vendor"
./sourcegraph.ts --query "sq.Insert lang:go"
./sourcegraph.ts --query "sq.Update lang:go"
./sourcegraph.ts --query "sq.Delete lang:go"
```

### CRUD Operations

```bash
# Find create/read/update/delete patterns
./sourcegraph.ts --query "sq.Insert lang:go"
./sourcegraph.ts --query "sq.Update lang:go"
./sourcegraph.ts --query "sq.Delete lang:go"
```

### Conditionals

```bash
# Find where clause patterns
./sourcegraph.ts --query "sq.Eq lang:go -file:vendor"
./sourcegraph.ts --query "sq.Where lang:go"
./sourcegraph.ts --query "sq.And lang:go"
./sourcegraph.ts --query "sq.Or lang:go"
```

### Exact Phrases

```bash
# Search for exact strings
./sourcegraph.ts --query '"useState" lang:typescript'
./sourcegraph.ts --query '"with open" lang:python -file:test'
```

### Repository-Specific

```bash
# Search specific repository (use regex anchor)
./sourcegraph.ts --query 'repo:^github\.com/kubernetes/kubernetes$ PodScheduler'

# Prefer broad search first, then narrow down
./sourcegraph.ts --query "kubernetes PodScheduler lang:go"
```

### Cross-Repository Patterns

```bash
# Find patterns across multiple repos
./sourcegraph.ts --query "lang:go context.WithTimeout AND retry"
./sourcegraph.ts --query "lang:typescript redux middleware"
```

## Context Window Guide

The `--context-window` parameter controls how many surrounding lines to show per match:

| Value | Use Case |
|-------|----------|
| 0 | Show only the matching line (minimal context) |
| 1-2 | Quick preview (may miss important context) |
| 3-5 | **Sweet spot** - enough context to understand patterns |
| 6-10 | Deep dive (may include too much noise) |

```bash
# Default: 3 lines on each side of match
./sourcegraph.ts --query "sq.Select lang:go"

# More context for complex patterns
./sourcegraph.ts --query "lang:typescript useEffect cleanup" --context-window 5

# Minimal context
./sourcegraph.ts --query "flask route lang:python" --context-window 1
```

## Troubleshooting

### Query Times Out (>30s)

**Cause:** Complex regex patterns, too many results, or slow repositories.

**Solutions:**

1. **Simplify the pattern**
   ```bash
   # Before (times out)
   ./sourcegraph.ts --query "sq.(Select|Insert|Update|Delete) lang:go"

   # After (fast)
   ./sourcegraph.ts --query "sq.Select lang:go"
   ```

2. **Add more filters**
   ```bash
   # Narrow by repository
   ./sourcegraph.ts --query "sq.Select lang:go repo:^github\.com/org/repo$"

   # Exclude more files
   ./sourcegraph.ts --query "sq.Select lang:go -file:vendor -file:test -file:mock"
   ```

3. **Reduce count**
   ```bash
   ./sourcegraph.ts --query "sq.Select lang:go" --count 5
   ```

4. **Increase timeout**
   ```bash
   ./sourcegraph.ts --query "sq.Select lang:go" --timeout 60
   ```

### No Results Found

**Possible causes:**

1. **Query too specific** - Try broader patterns
   ```bash
   # Too specific
   ./sourcegraph.ts --query "squirrel.SelectExactly lang:go"

   # Better
   ./sourcegraph.ts --query "sq.Select lang:go"
   ```

2. **Wrong language filter** - Verify language name
   ```bash
   # Correct: lang:typescript, lang:go, lang:python
   ./sourcegraph.ts --query "useState lang:typescript"
   ```

3. **Over-filtering** - Remove some filters
   ```bash
   # Try without file exclusion
   ./sourcegraph.ts --query "sq.Select lang:go"  # No -file:vendor
   ```

### Network Errors

The script uses **fetch with curl fallback** for reliability:

1. **Check internet connection**
   ```bash
   curl -I https://sourcegraph.com
   ```

2. **Try with increased timeout**
   ```bash
   ./sourcegraph.ts --query "sq.Select lang:go" --timeout 60
   ```

3. **Verify query syntax**
   ```bash
   # Escape special characters properly
   ./sourcegraph.ts --query 'repo:^github\.com/org/repo$'
   ```

## Output Format

Results include:

- **Match statistics**: Total matches, files searched, elapsed time
- **Code snippets**: Context lines around matches
- **Source links**: Direct links to Sourcegraph for further exploration

Example output:

```
Found 25 matches in 8 files (450ms)

## github.com/go-xorm/builder - builder.go
[View on Sourcegraph](https://sourcegraph.com/github.com/go-xorm/builder/-/blob/builder.go)

15:       Select(col ...string) *Builder {
16:               return &Builder{selector: &Selector{cols: col}}
17:       }

## github.com/Masterminds/squirrel - select.go
[View on Sourcegraph](https://sourcegraph.com/github.com/Masterminds/squirrel/-/blob/select.go)

45: func (b SelectBuilder) ToSql() (string, []interface{}, error) {
46:       return b.toSql()
47: }
```

**Use the Sourcegraph links** to:
- View full file context
- Explore related files
- Check repository documentation
- Verify implementation details

## Workflow Examples

### Pattern 1: Learn a New Library

```bash
# 1. Start with basic usage
./sourcegraph.ts --query "sq.Select lang:go -file:vendor" --count 5

# 2. Explore specific operations
./sourcegraph.ts --query "sq.Insert lang:go" --count 5

# 3. Find advanced patterns
./sourcegraph.ts --query "sq.Join lang:go -file:vendor" --context-window 5
```

### Pattern 2: Find Implementation Examples

```bash
# 1. Search for the pattern
./sourcegraph.ts --query "lang:go rate limiting middleware" --count 10

# 2. Narrow down by specific implementation
./sourcegraph.ts --query "lang:go token bucket rate limiter" --count 5

# 3. Explore specific repos via Sourcegraph links
# (Click links from output to browse)
```

### Pattern 3: Cross-Reference Patterns

```bash
# 1. Find pattern in Go
./sourcegraph.ts --query "context.WithTimeout lang:go -file:test"

# 2. Find equivalent in TypeScript
./sourcegraph.ts --query "setTimeout promise lang:typescript -file:test"

# 3. Compare implementations
# (Use Sourcegraph links to explore both)
```

### Pattern 4: Debug Implementation Issues

```bash
# 1. Find how others handle this
./sourcegraph.ts --query "lang:go redis connection pool" --context-window 5

# 2. Look for error handling patterns
./sourcegraph.ts --query "lang:go redis error handling retry" --context-window 5

# 3. Check production examples
./sourcegraph.ts --query "lang:go redis -file:test -file:mock" --count 15
```

## Advanced Usage

### JSON Input for Automation

```bash
# Pipe JSON from other tools
echo '{"query":"sq.Select lang:go","count":5,"context_window":3}' | ./sourcegraph.ts

# Use in scripts
cat <<EOF | ./sourcegraph.ts
{
  "query": "lang:typescript useEffect cleanup",
  "count": 10,
  "context_window": 5,
  "timeout": 60
}
EOF
```

### Combining with Other Tools

```bash
# Search and save results
./sourcegraph.ts --query "sq.Select lang:go" > results.txt

# Search and extract URLs
./sourcegraph.ts --query "sq.Select lang:go" | grep "sourcegraph.com"

# Search and count matches
./sourcegraph.ts --query "sq.Select lang:go" | grep "Found.*matches"
```

## Reference Materials

See [QUERY_REFERENCE.md](QUERY_REFERENCE.md) for:
- Complete filter syntax
- Boolean operator examples
- Pattern type options (keyword, literal, regexp, structural)
- Additional search examples

## Tips for AI Agents

When using this skill to help with coding tasks:

1. **Start broad, then narrow** - Use simple queries first, add filters as needed
2. **Always use language filters** - Makes results much more relevant
3. **Exclude test/vendor files** - Unless you specifically need test examples
4. **Use Sourcegraph links** - They provide full context and related files
5. **Search for patterns, not exact code** - Find how others solve problems
6. **Cross-reference multiple repos** - Different approaches to the same problem
7. **Adjust context window** - Use 3-5 for understanding patterns, 1-2 for quick scans

## When to Use This Skill

- **Learning a new library** - See real-world usage examples
- **Finding implementation patterns** - How others solve common problems
- **API discovery** - Understand how functions/methods are used
- **Code research** - Explore unfamiliar codebases without cloning
- **Best practices** - See production-quality implementations
- **Troubleshooting** - Find how others handle edge cases
- **Architecture exploration** - Understand project structures and patterns
