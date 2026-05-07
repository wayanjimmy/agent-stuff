---
name: pdd
description: >
  Prompt Driven Development — a research-first methodology that produces structured
  design canvases with explicit constraints for AI coding agents. Use when you need
  to investigate a technical problem (spike), capture findings in a structured canvas,
  generate implementation contracts for AI, or sync design docs back to code.
  Combines time-boxed research (spike documents) with executable design contracts.
---

# Prompt Driven Development (PDD)

## Philosophy

PDD is built on two principles:

1. **Research before build** — Replace ambiguity with data through time-boxed investigation (spikes)
2. **Constrain AI behavior** — Turn research findings into executable design contracts with explicit "must not" rules

> *"When reality diverges, fix the prompt first — then update the code."*

## When to Use PDD

**Use a spike when:**
- Evaluating unfamiliar technologies or frameworks
- Assessing feasibility of a proposed approach
- Understanding cross-system impacts
- Estimating complex features before committing to implementation

**Use a canvas when:**
- Converting spike findings into implementation contracts
- Generating code with AI while maintaining design control
- Creating bidirectional sync between design and implementation

**Do NOT use PDD for:**
- Trivial changes with clear solutions
- Bug fixes with obvious root causes
- Pure refactoring with no behavioral changes

## PDD Canvas (9 Dimensions)

```
┌─────────────────────────────────────────────────────────────────┐
│  P - Purpose        Why this exists (business context)         │
│  S - Spike Findings Research results, PoC validation           │
│  A - Approach       Strategy & trade-offs considered           │
│  R - Requirements   Functional + non-functional requirements   │
│  T - Tasks          Breakdown with T-shirt sizes               │
│  E - Entities       Domain model (indented lists with signatures)  │
│  D - Design         Architecture, patterns, structure          │
│  R - Risks          Blockers, mitigations, fallbacks           │
│  S - Safeguards     Constraints — what must NOT be done        │
└─────────────────────────────────────────────────────────────────┘
```

**Why these 9 dimensions?**

- Without **S+Spike** (Spike Findings) → you're guessing, not researching
- Without **A+D** (Approach + Design) → AI improvises architecture
- Without **T** (Tasks) → no implementation plan
- Without **R+R** (Requirements + Risks) → no context or fallbacks
- Without **S** (Safeguards) → AI goes off course

## PDD Workflow (5 Phases)

### Phase 0: Scan the Codebase

Before any questions, gather context:

1. **Find existing canvases.** Check `.pdd/`, `.pdd/spikes/`
2. **Check the tech stack.** Read `package.json`, `go.mod`, `requirements.txt`, etc.
3. **Find related code patterns.** Identify files, directories, and patterns affected
4. **Check for canvas references in code.** Look for `PDD-NNNN` in comments and docs

### Phase 1: Capture Intent (Socratic)

Interview the human to understand the decision space. Ask **one question at a time**, building on previous answers.

**Core questions (ask in roughly this order, skip what's already clear):**

1. What problem are you trying to solve?
2. What constraints exist (time, team, tech stack, business rules)?
3. What have you already tried or considered?
4. What does "done" look like?
5. What must NOT change or break?

**When to stop:** You have enough when you can fill every section of the PDD Canvas without making things up.

**Intent Summary Gate:** Before proceeding, present a structured summary:

```
Here's what I'm capturing for the PDD Canvas:

- Purpose: [problem context]
- Spike Findings: [what we know so far]
- Approach: [direction]
- Requirements: [what's needed]
- Tasks: [initial breakdown]
- Entities: [key concepts]
- Design: [architecture]
- Risks: [known concerns]
- Safeguards: [constraints]

Does this capture your intent? Anything to add or correct?
```

Do NOT proceed until the human confirms.

### Phase 2: Spike (Time-Boxed Research)

**Time-box:** 1-5 days (typically 1 day for most spikes)

**Deliverables:**

1. **Technical Approach Document** — Architecture rationale, patterns chosen
2. **PoC Validation** — Experimental code that validates the approach
3. **Architecture Diagrams** — Mermaid diagrams of components and data flows
4. **Risk Assessment** — Blockers identified, mitigation strategies
5. **Task Breakdown** — T-shirt sized tasks (S/M/L) with dependencies

**During the spike:**
- Document what you learn, including dead ends
- Note which alternatives you rejected and why
- Capture version numbers and specific configurations
- Create minimal PoC code that proves the approach works

### Phase 3: Draft the PDD Canvas

Generate the full canvas with all 9 dimensions. Use the template from `assets/templates/pdd-canvas.md`.

**Key requirements for an "executable" canvas:**

- **Safeguards must be testable.** "Use proper error handling" is bad. "Return HTTP 422 with JSON `{"error": "validation_failed"}` for invalid input" is good.
- **Tasks must be specific.** "Implement billing service" is bad. "Create `src/billing/service.ts` with method `calculateTotal(items: CartItem[]): number`" is good.
- **Entities must include interfaces.** Indented lists with method signatures, not abstract diagrams.
- **Design must reference files.** "Use existing auth pattern" is bad. "Follow pattern in `src/auth/handler.ts`" is good.
- **Diagrams must be readable as plain text.** Use ASCII art in code blocks, numbered steps for flows, and tables for relationships. If a diagram is too large, split it into multiple smaller diagrams.

### Phase 4: Review

Validate the canvas against this checklist:

```
Agent-Readiness Checklist:

□ Could an agent implement this from the canvas alone?
□ Are all verification criteria testable?
□ Is the implementation plan specific (files, methods, patterns)?
□ Are Safeguards enforceable (not just suggestions)?
□ Does the PoC validate the core assumptions?
□ Are Tasks ordered with clear dependencies?
□ Does the canvas reference specific files and patterns in the codebase?
```

If any answer is "no," return to Phase 3 and fix.

### Phase 5: Sync (Bidirectional)

After implementation (or during refactoring), sync the canvas with actual code.

**When to sync:**
- After AI implements the canvas
- After manual refactoring
- Before starting a new feature
- During code review

**How to sync:**

```bash
# Dry run (see what would change)
deno task sync-dry 0001

# Apply changes
deno task sync 0001

# Sync all canvases
deno task sync --all
```

**What gets synced:**

| Canvas Section | Sync Source |
|----------------|-------------|
| Tasks | Check if files exist, mark completed |
| Entities | Scan method signatures |
| Safeguards | Look for `PDD-NNNN` comments |
| Design | Detect new files |

**Core principle:** *"When reality diverges, fix the prompt first — then update the code."*

If the sync finds mismatches:
1. First, ask: should the code change to match the canvas?
2. If no, update the canvas to reflect reality
3. Run sync again to confirm match

## Canvas ↔ Code Linking

In code, reference the governing canvas:

```typescript
// PDD-0001: Use event-driven architecture for notifications
// See: .pdd/0001-notification-architecture.md
```

In the canvas, reference specific files:

```markdown
### Verification

- [ ] Unit test in `src/notification/__tests__/handler.test.ts`
- [ ] Integration test with mock event bus
```

## Diagram Conventions

All diagrams in PDD canvases must be **readable as plain text** — no Mermaid, no external renderers.

### Architecture Diagrams

Use ASCII art in code blocks:

```
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

### Data Flows

Use numbered steps, split into multiple flows if large:

```markdown
### Flow 1: Login

1. Client sends POST /api/auth/login with credentials
2. Gateway forwards to Auth Service
3. Auth Service verifies against database
4. Auth Service generates JWT tokens
5. Gateway returns tokens to client

### Flow 2: Protected Request

1. Client sends request with Bearer token
2. Gateway extracts token
3. Gateway checks Redis blacklist
4. Gateway verifies signature
5. Gateway forwards to target service
```

### Entities

Use indented lists with method signatures:

```markdown
### User
- `id: string`
- `email: string`
- `roles: Role[]`
- `createToken(): TokenPair`

### TokenService
- `generateToken(user: User): Token`
- `validateToken(token: string): boolean`
- `revokeToken(jti: string): void`
```

### Relationships

Use tables for connections between entities:

```markdown
| From | Relationship | To |
|------|--------------|----|
| User | has many | Role |
| TokenService | uses | Redis |
| Gateway | forwards to | Auth Service |
```

### When to Split

If a diagram would be more than ~20 lines, split it:
- Architecture → Split by layer (client, gateway, service, database)
- Flows → Split by use case (login, logout, refresh)
- Entities → Split by domain (auth, billing, notifications)

## Templates

- **`pdd-canvas.md`** — Full 9-dimension canvas template
- **`pdd-spike.md`** — Spike document template (Phase 2)
- **`pdd-simple.md`** — Lightweight canvas for straightforward decisions

## Scripts

- `new_canvas.js` — Create a new canvas (auto-detects conventions)
- `new_spike.js` — Create a new spike document
- `set_canvas_status.js` — Update canvas status (YAML front matter)
- `bootstrap_pdd.js` — Initialize PDD structure in a repo
