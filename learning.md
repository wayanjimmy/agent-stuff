# Sourcegraph Librarian Tool - Learnings & Best Practices

## Overview
After using the Sourcegraph librarian tool to search for Go projects using the `squirrel` query builder, I've identified several patterns for effective usage and common pitfalls to avoid.

## Key Learnings

### 1. **Timeout Issues with Complex Queries**

**Problem**: Several queries timed out after 30 seconds:
```
Search timed out after 30s. Try a more specific query with filters like 'lang:' or 'repo:'.
```

**Cause**: Queries that were too broad or had complex regex patterns:
- `sq\.Where lang:go -file:vendor` - Complex regex escaping
- `squirrel\.PlaceholderFormat lang:go` - Too specific without repo context
- Long queries with multiple OR operators: `QueryBuilder|SelectBuilder|InsertBuilder lang:go -file:vendor -file:test squirrel`

**Solution**: Start with simpler, more targeted queries:
- ✅ `sq.Select lang:go -file:vendor` - Simple function call
- ✅ `sq.Update lang:go` - Simple function call
- ✅ `lang:go repo:github.com/autobrr/autobrr` - Repo-scoped search

### 2. **Regex Escaping Issues**

**Problem**: Queries with escaped dots or special characters often returned no results:
```
Found 0 results for query: "squirrel\.Select|squirrel\.Insert|squirrel\.Update|squirrel\.Delete lang:go -file:vendor"
```

**Cause**: Over-escaping or complex regex patterns that don't match actual code patterns.

**Solution**: Use simpler patterns or avoid regex escaping when possible:
- ❌ `squirrel\.Select|squirrel\.Insert|squirrel\.Update|squirrel\.Delete`
- ✅ `squirrel.Select` (search separately for each operation)
- ✅ `sq.Select` (most common import alias)

### 3. **Vendor Directory Pollution**

**Problem**: Initial searches returned mostly vendored copies of the library itself rather than usage:
```
github.com/Shopify/ghostferry - vendor/github.com/Masterminds/squirrel/row.go
github.com/Shopify/ghostferry - vendor/github.com/Masterminds/squirrel/expr.go
```

**Solution**: Always exclude vendor directories:
- ✅ `-file:vendor` - Excludes any file in a vendor directory
- ✅ `-file:Vendor` - Case-insensitive exclusion
- ✅ `-file:_test\.go$` - Also exclude test files for cleaner results

### 4. **Import Statement vs Usage Patterns**

**Discovery**: Two approaches to finding usage:

**Approach A: Import statements** (limited results)
```
import "github.com/Masterminds/squirrel" lang:go -file:vendor
```
- ✅ Precise - finds actual imports
- ❌ Misses projects using alias imports
- ❌ Only 2 results found

**Approach B: Usage patterns** (better coverage)
```
sq.Select lang:go -file:vendor
squirrel.Select lang:go -file:vendor
```
- ✅ Finds actual usage regardless of import style
- ✅ More comprehensive results
- ✅ Shows implementation patterns

### 5. **Search Strategy: Funnel Approach**

**Effective workflow**:

1. **Start broad** with common patterns:
   ```
   sq.Select lang:go -file:vendor
   ```

2. **Narrow by specific operations**:
   ```
   sq.Insert lang:go
   sq.Update lang:go
   sq.Delete lang:go
   ```

3. **Search for conditionals**:
   ```
   sq.Eq lang:go -file:vendor
   sq.And lang:go -file:vendor
   ```

4. **Explore specific repositories** that appeared in results:
   ```
   sq.Where repo:github.com/autobrr/autobrr
   ```

### 6. **Context Window Matters**

**Observation**: Results with `contextWindow: 3-5` provided good balance:
- Too low (1-2): Insufficient context to understand usage
- Too high (10+): Too much noise, harder to parse
- Sweet spot: 3-5 lines for understanding patterns

**Example**:
```
# Good context
qb := r.db.squirrel.Select(
96:  qb := r.db.squirrel.Select(
434: qb := r.db.squirrel.Select(
```

Shows the pattern without overwhelming detail.

### 7. **Count Parameter Strategy**

**Finding**: 
- `count: 20` is the maximum and typically sufficient
- First page often contains the most relevant results
- If you need more, vary the search query rather than increasing count

### 8. **Repository-Specific Queries**

**Problem**: Some repo-scoped queries timed out:
```
sq.Where lang:go repo:github.com/autobrr/autobrr
# Timed out after 30s
```

**Working approach**:
```
# More specific pattern within repo
sq.Select repo:github.com/autobrr/autobrr
```

**Better**: Search broadly first, then explore interesting repos via Sourcegraph links.

### 9. **Common Query Patterns That Work**

| Query Type | Example | Result |
|------------|---------|--------|
| Direct function call | `sq.Select lang:go -file:vendor` | ✅ 20 results |
| Import alias usage | `sq.Eq lang:go -file:vendor` | ✅ 20 results |
| CRUD operations | `sq.Update lang:go` | ✅ 20 results |
| Specific methods | `sq.Insert lang:go` | ✅ 20 results |
| Delete operations | `sq.Delete lang:go` | ✅ 20 results |

### 10. **Patterns to Avoid**

| Query Pattern | Issue | Alternative |
|---------------|-------|-------------|
| Complex regex OR | `a\.X\|b\.Y\|c\.Z` | Search separately |
| Over-escaped dots | `squirrel\.Select` | Use `squirrel.Select` |
| Too specific + broad | `squirrel\.PlaceholderFormat lang:go` | Add repo filter or simplify |
| Multiple file exclusions | `-file:vendor -file:test -file:mock` | Just `-file:vendor` often enough |
| Combined filters without lang | `repo:^github\.com/org.*Select` | Add `lang:go` |

## Practical Recommendations

### For Library Usage Research

1. **Search by common import aliases** first:
   - `sq.*` for squirrel
   - `db.*` for database operations
   - Function names: `Select`, `Insert`, `Update`, `Delete`

2. **Exclude noise**:
   - Always use `-file:vendor`
   - Consider `-file:_test\.go$` for production code only
   - Consider `-file:generated` for codegen projects

3. **Iterate from broad to specific**:
   ```
   # Step 1: Find any usage
   sq.Select lang:go -file:vendor
   
   # Step 2: Find specific patterns
   sq.Eq lang:go -file:vendor
   
   # Step 3: Explore specific repos via Sourcegraph UI
   ```

### Query Optimization Checklist

- [ ] Start with simple patterns (no complex regex)
- [ ] Include language filter: `lang:go`
- [ ] Exclude vendor: `-file:vendor`
- [ ] Use common aliases: `sq` not `squirrel`
- [ ] Keep queries under 30 seconds (simpler patterns)
- [ ] Use context window: 3-5 lines
- [ ] Start with count: 10-20 results

### Effective Search Patterns

**For finding projects using a library**:
```
# Search import alias usage
<alias>.Select lang:go -file:vendor

# Example for squirrel
sq.Select lang:go -file:vendor
```

**For understanding usage patterns**:
```
# Specific operations
<alias>.Insert lang:go -file:vendor
<alias>.Update lang:go -file:vendor
<alias>.Delete lang:go -file:vendor

# Conditionals
<alias>.Eq lang:go -file:vendor
<alias>.Where lang:go -file:vendor
```

**For finding specific implementations**:
```
# Combine with specific terms
<alias>.Select repo:<org>/<repo>
```

## Conclusion

The Sourcegraph librarian tool is powerful but requires:
1. **Simple, targeted queries** - avoid complex regex
2. **Progressive refinement** - start broad, narrow down
3. **Practical exclusions** - always exclude vendor/test files
4. **Patience with timeouts** - if it times out, simplify the query
5. **Leverage results** - use Sourcegraph links to explore repos further

The key insight: **Simple queries with language filters and file exclusions perform best**. Complex patterns and over-specific searches often time out or return zero results.
