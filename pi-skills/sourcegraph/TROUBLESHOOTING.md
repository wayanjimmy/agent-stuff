# Troubleshooting & Advanced Usage

## Output Format

Results include match statistics, code snippets with context lines, and Sourcegraph links.

```
Found 25 matches in 8 files (450ms)

## github.com/Masterminds/squirrel - select.go
[View on Sourcegraph](https://sourcegraph.com/...)

45: func (b SelectBuilder) ToSql() (string, []interface{}, error) {
46:       return b.toSql()
47: }
```

**Use Sourcegraph links** to view full file context, explore related files, and verify implementation details.

## Troubleshooting

### Query Times Out (>30s)

**Cause:** Complex regex, too many results, or slow repositories.

**Solutions:**

1. **Simplify the pattern** — avoid OR groups like `sq.(Select|Insert|Update|Delete)`
2. **Add more filters** — narrow by repo, exclude vendor/test/mock
3. **Reduce count** — use `--count 5`
4. **Increase timeout** — use `--timeout 60`

### No Results Found

- **Query too specific** — try broader patterns, use short aliases
- **Wrong language filter** — verify language name (`lang:typescript`, `lang:go`, `lang:python`)
- **Over-filtering** — remove some filters and try again

### Network Errors

```bash
# Check connectivity
curl -I https://sourcegraph.com
# Increase timeout
./sourcegraph.ts --query "sq.Select lang:go" --timeout 60
# Escape special characters
./sourcegraph.ts --query 'repo:^github\.com/org/repo$'
```

## Workflow Examples

### Learn a New Library

```bash
# 1. Start with basic usage
./sourcegraph.ts --query "sq.Select lang:go -file:vendor" --count 5
# 2. Explore specific operations
./sourcegraph.ts --query "sq.Insert lang:go" --count 5
# 3. Advanced patterns
./sourcegraph.ts --query "sq.Join lang:go -file:vendor" --context-window 5
```

### Find Implementation Examples

```bash
./sourcegraph.ts --query "lang:go rate limiting middleware" --count 10
./sourcegraph.ts --query "lang:go token bucket rate limiter" --count 5
```

### Cross-Reference Patterns

```bash
# Go
./sourcegraph.ts --query "context.WithTimeout lang:go -file:test"
# TypeScript equivalent
./sourcegraph.ts --query "setTimeout promise lang:typescript -file:test"
```

### Debug Implementation Issues

```bash
./sourcegraph.ts --query "lang:go redis connection pool" --context-window 5
./sourcegraph.ts --query "lang:go redis error handling retry" --context-window 5
./sourcegraph.ts --query "lang:go redis -file:test -file:mock" --count 15
```

## Advanced Usage

### JSON Input for Automation

```bash
echo '{"query":"sq.Select lang:go","count":5,"context_window":3}' | ./sourcegraph.ts

cat <<EOF | ./sourcegraph.ts
{"query":"lang:typescript useEffect cleanup","count":10,"context_window":5,"timeout":60}
EOF
```

### Combining with Other Tools

```bash
# Save results
./sourcegraph.ts --query "sq.Select lang:go" > results.txt
# Extract URLs
./sourcegraph.ts --query "sq.Select lang:go" | grep "sourcegraph.com"
# Count matches
./sourcegraph.ts --query "sq.Select lang:go" | grep "Found.*matches"
```