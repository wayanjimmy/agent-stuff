---
status: {proposed | active | completed | superseded by PDD-NNNN}
date: YYYY-MM-DD
authors: {list of people involved}
timebox: {estimated days for spike}
---

# PDD-NNNN: {Short title, representative of the problem and solution}

## P — Purpose

{Why does this need to happen now? What business context drives this? Include enough background that an agent reading this for the first time can understand without follow-up questions.}

## S — Spike Findings

{What research was done? What did you discover? Include:}
- Technologies evaluated
- PoC results (with code snippets or links)
- Dead ends explored and why they were rejected
- Key learnings that shaped the approach

### PoC Validation

```typescript
// Minimal code that proves the approach works
// Include actual runnable code, not pseudocode
```

## A — Approach

{What strategy are we taking? What trade-offs did we make? Why this approach over alternatives?}

### Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| {Option A} | ... | ... | ✓/✗ |
| {Option B} | ... | ... | ✓/✗ |

## R — Requirements

### Functional

- [ ] {Requirement 1}
- [ ] {Requirement 2}

### Non-Functional

- [ ] Performance: {specific targets}
- [ ] Security: {specific constraints}
- [ ] Scalability: {expected load}

## T — Tasks

| # | Task | Size | Dependencies | Files | Done |
|---|------|------|--------------|-------|------|
| 1 | {Task description} | S/M/L | — | `src/path/file.ts` | |
| 2 | {Task description} | S/M/L | #1 | `src/path/file.ts` | |
| 3 | {Task description} | S/M/L | #1, #2 | `src/path/file.ts` | |

### Task Details

#### Task 1: {Name}

**What:** {Specific description}
**Files:** `src/path/to/file.ts`
**Pattern:** Follow existing pattern in `src/existing/pattern.ts`
**Dependencies:** None
**Verification:** {How to verify this task is done}

## E — Entities

### {Entity Name 1}

- `field: Type` — {description}
- `field: Type` — {description}
- `method(param: Type): ReturnType` — {what it does}

### {Entity Name 2}

- `field: Type` — {description}
- `method(param: Type): ReturnType` — {what it does}

### Relationships

| From | Relationship | To | Notes |
|------|--------------|----|-------|
| {Entity} | uses | {Entity} | {context} |
| {Entity} | has many | {Entity} | {context} |

## D — Design

### Architecture

```
{ASCII diagram showing component relationships}

Example:
Client
  │
  ▼
API Gateway ──→ Redis (cache)
  │
  ▼
Auth Service
  │
  ▼
Database
```

### Patterns to Follow

- **Error handling:** Follow pattern in `src/auth/handler.ts` — try/catch with typed errors
- **Logging:** Use `logger` from `src/utils/logger.ts`
- **Validation:** Use `zod` schemas in `src/validation/`

### Configuration

```typescript
// src/config/feature.ts
export const config = {
  // Exact config shape
}
```

### Data Flow

#### Flow 1: {Name}

1. {Step 1: Who does what}
2. {Step 2: Who does what}
3. {Step 3: Who does what}

#### Flow 2: {Name}

1. {Step 1: Who does what}
2. {Step 2: Who does what}
3. {Step 3: Who does what}

## R — Risks

| Risk | Likelihood | Impact | Mitigation | Fallback |
|------|-----------|--------|------------|----------|
| {Risk 1} | High/Med/Low | High/Med/Low | {What we'll do to prevent} | {What we'll do if it happens} |
| {Risk 2} | High/Med/Low | High/Med/Low | {What we'll do to prevent} | {What we'll do if it happens} |

## S — Safeguards

{What must NOT be done. Be specific and enforceable.}

### Code Constraints

- ❌ **DO NOT** modify `src/core/engine.ts` without explicit approval
- ❌ **DO NOT** introduce new database migrations without updating `docs/schema.md`
- ❌ **DO NOT** use `any` type — all types must be explicitly defined

### Error Handling Constraints

- ❌ **DO NOT** swallow errors silently — always log with context
- ❌ **DO NOT** return generic 500 errors — use typed error responses

### Testing Constraints

- ❌ **DO NOT** skip integration tests for database operations
- ❌ **DO NOT** mock external services in integration tests

## Verification

### Unit Tests

- [ ] Test file: `src/path/__tests__/module.test.ts`
- [ ] Coverage target: {specific percentage or critical paths}

### Integration Tests

- [ ] Test file: `tests/integration/feature.test.ts`
- [ ] Scenario: {specific test scenario}

### Manual Verification

- [ ] {How a human can verify the feature works}
- [ ] {Specific edge cases to test}

## Footer

### Related Documents

- {Link to related PDD canvases}
- {Link to relevant ADRs}
- {Link to PRs/issues}

### Changelog

| Date | Change | Author |
|------|--------|--------|
| YYYY-MM-DD | Initial canvas | {name} |
