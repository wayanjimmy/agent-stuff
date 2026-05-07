---
status: {in-progress | completed | abandoned}
date: YYYY-MM-DD
timebox: {1-5 days}
authors: {list of people involved}
canvas: {link to PDD-NNNN if this spike feeds into one}
---

# Spike: {Title}

## Timebox

**Start:** YYYY-MM-DD
**End:** YYYY-MM-DD
**Total days:** {N}

## Objective

{What question are we trying to answer? What decision are we trying to make?}

### Success Criteria

- [ ] {What "done" looks like for this spike}
- [ ] {Specific questions that must be answered}

## Context

{Background information relevant to this spike. What's the business context? What constraints exist?}

## Investigation Plan

### Day 1: {Focus area}

- [ ] {Specific task}
- [ ] {Specific task}

### Day 2: {Focus area}

- [ ] {Specific task}
- [ ] {Specific task}

### Day 3: {Focus area}

- [ ] {Specific task}
- [ ] {Specific task}

## Technologies Evaluated

### Option A: {Technology/Approach}

**What is it:** {Brief description}
**Pros:**
- {Pro 1}
- {Pro 2}

**Cons:**
- {Con 1}
- {Con 2}

**PoC Result:**

```typescript
// Minimal code showing how this works
```

**Verdict:** ✓ Selected / ✗ Rejected

### Option B: {Technology/Approach}

**What is it:** {Brief description}
**Pros:**
- {Pro 1}
- {Pro 2}

**Cons:**
- {Con 1}
- {Con 2}

**PoC Result:**

```typescript
// Minimal code showing how this works
```

**Verdict:** ✓ Selected / ✗ Rejected

## PoC Validation

### Environment Setup

{What did you need to set up to run the PoC?}

```bash
# Example setup commands
```

### Core Validation

```typescript
// The actual PoC code that proves the approach works
// This should be runnable, not pseudocode
```

### Results

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| {Metric 1} | {Expected} | {Actual} | ✓/✗ |
| {Metric 2} | {Expected} | {Actual} | ✓/✗ |

## Findings

### What Worked

- {Finding 1}
- {Finding 2}

### What Didn't Work

- {Finding 1} — Why it failed
- {Finding 2} — Why it failed

### Dead Ends

- **{Approach A}:** {Why we stopped pursuing this}
- **{Approach B}:** {Why we stopped pursuing this}

## Architecture

### Current State

```
{ASCII diagram of current architecture}

Example:
Client
  │
  ▼
Monolith (auth + business + data)
  │
  ▼
Database
```

### Proposed State

```
{ASCII diagram of proposed architecture}

Example:
Client
  │
  ▼
API Gateway
  │
  ├──→ Auth Service (JWT)
  │
  ├──→ Business Service
  │
  └──→ Data Service
         │
         ▼
      Database
```

### Changes Between States

| Component | Current | Proposed | Impact |
|-----------|---------|----------|--------|
| Auth | Session in DB | JWT + Redis | Stateless, scalable |
| Services | Monolith | Microservices | Independent deploy |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| {Risk 1} | High/Med/Low | High/Med/Low | {Mitigation} |
| {Risk 2} | High/Med/Low | High/Med/Low | {Mitigation} |

## Task Breakdown (T-Shirt Sizes)

| # | Task | Size | Dependencies | Notes |
|---|------|------|--------------|-------|
| 1 | {Task} | S | — | |
| 2 | {Task} | M | #1 | |
| 3 | {Task} | L | #1, #2 | |

### Size Guide

- **S (Small):** < 1 day, clear path
- **M (Medium):** 1-2 days, some unknowns
- **L (Large):** 3-5 days, significant complexity

## Recommendation

{What should we do based on this spike? Be specific.}

### Chosen Approach

{Which option did we choose and why?}

### Next Steps

1. {Immediate next action}
2. {Follow-up action}
3. {Longer-term consideration}

### Open Questions

- {Question that still needs answering}
- {Question for product team}

## Appendix

### Links

- {Link to relevant documentation}
- {Link to PoC repository}
- {Link to related issues}

### Version Numbers

| Technology | Version | Notes |
|------------|---------|-------|
| {Tech 1} | {Version} | {Any relevant notes} |
| {Tech 2} | {Version} | {Any relevant notes} |
