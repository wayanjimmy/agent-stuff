# Prompt Driven Development (PDD)

A research-first methodology that produces structured design canvases with explicit constraints for AI coding agents.

## Philosophy

PDD combines two principles:

1. **Research before build** — Replace ambiguity with data through time-boxed investigation (spikes)
2. **Constrain AI behavior** — Turn research findings into executable design contracts with explicit "must not" rules

> *"When reality diverges, fix the prompt first — then update the code."*

## Why PDD?

| Problem | Typical Plan Documents | PDD Canvas |
|---------|------------------------|------------|
| **Nature** | Task list | Design contract |
| **Research** | Assumptions | Spike findings with PoC validation |
| **Constraints** | None — AI improvises | Safeguards define "must not do" |
| **Detail** | High-level | Precise: method signatures, error handling |
| **Traceability** | None | Bidirectional sync |
| **Verification** | Vague | Explicit test criteria |

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

## PDD Workflow

```
Business Requirement
        │
        ▼
/pdd-analysis ──────→ Strategic analysis (concepts, risks)
        │
        ▼
/pdd-spike ─────────→ Time-boxed research + PoC
        │
        ▼
/pdd-canvas ────────→ PDD Canvas (spike findings + constraints)
        │
        ▼
/pdd-generate ──────→ AI generates code from contract
        │
        ▼
/pdd-sync ──────────→ Reverse-sync code → canvas
        │
        ▼
Canvas stays in sync → Next cycle based on accurate design
```

## Quick Start

### Install

```bash
# Clone or copy the skill to your project
git clone https://github.com/youruser/prompt-driven-dev.git
cd prompt-driven-dev

# Run the installer (detects your agent)
./install.sh

# Or install for a specific agent
./install.sh pi
./install.sh gemini
./install.sh claude
./install.sh cursor
./install.sh global  # Install globally for Pi
```

### Manual Install

Copy `skills/pdd/` to your agent's skill directory:

| Agent | Location |
|-------|----------|
| Pi | `.pi/skills/pdd/` |
| Gemini | `.agents/skills/pdd/` |
| Claude | `.claude/skills/pdd/` |
| Cursor | `.cursor/skills/pdd/` |

### Bootstrap

```bash
deno task bootstrap
```

### Create a Spike

```bash
deno task new-spike "Evaluate JWT auth"
```

### Create a Canvas

```bash
# Full canvas
deno task new-canvas "Add rate limiting to API"

# Simple canvas
deno task new-canvas-simple "Fix login bug"
```

## Directory Structure

```
project/
├── .pdd/                              # Hidden PDD directory
│   ├── README.md                    # Index of all canvases
│   ├── 0001-add-rate-limiting.md   # Canvas files
│   ├── 0002-migrate-to-jwt.md
│   └── spikes/
│       ├── 0001-rate-limiting-research.md
│       └── 0002-jwt-evaluation.md
├── skills/
│   └── pdd/
│       ├── SKILL.md                    # Main skill definition
│       ├── assets/
│       │   └── templates/
│       │       ├── pdd-canvas.md       # Full 9-dimension template
│       │       ├── pdd-spike.md        # Spike document template
│       │       └── pdd-simple.md       # Lightweight canvas
│       ├── references/
│       │   ├── review-checklist.md     # Agent-readiness checklist
│       │   ├── examples.md             # Filled-out examples
│       │   └── pdd-conventions.md      # Naming & structure rules
│       └── scripts/
│           ├── new_canvas.js           # Create new canvas
│           ├── new_spike.js            # Create new spike
│           ├── sync_canvas.js          # Sync canvas with code
│           └── bootstrap_pdd.js        # Initialize PDD structure
└── src/
    └── ...
```

## Agent Integration

### Pi

Copy `skills/pdd/` to `.pi/skills/pdd/`

### Claude

Copy `skills/pdd/` to `.claude/skills/pdd/`

### Cursor

Copy `skills/pdd/` to `.cursor/skills/pdd/`

### Gemini

Copy `skills/pdd/` to `.agents/skills/pdd/`

## Canvas ↔ Code Linking

In code, reference the governing canvas:

```typescript
// PDD-0001: Use sliding window rate limiting
// See: .pdd/0001-add-rate-limiting.md
export function rateLimit() { ... }
```

In the canvas, reference specific files:

```markdown
### Files Affected

- `src/middleware/rateLimiter.ts` (new)
- `src/config/rateLimit.ts` (new)
```

## Diagram Conventions

All diagrams use **plain text** — no Mermaid, no external renderers. Readable anywhere:

### Architecture (ASCII art)

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

### Data Flows (numbered steps)

```markdown
1. Client sends POST /api/auth/login
2. Gateway forwards to Auth Service
3. Auth Service verifies against database
4. Auth Service generates JWT tokens
5. Gateway returns tokens to client
```

### Entities (indented lists)

```markdown
### User
- `id: string` — Unique identifier
- `email: string` — User email
- `createToken(): TokenPair` — Generate JWT pair
```

**Large diagrams?** Split into multiple smaller ones by layer, use case, or domain.

## Comparison with Other Approaches

| Feature | PDD | OpenSPDD | ADR Skill |
|---------|-----|----------|-----------|
| **Research phase** | ✓ Spike documents | ✗ | ✗ |
| **PoC validation** | ✓ Built-in | ✗ | ✗ |
| **T-shirt estimates** | ✓ Required | ✗ | ✗ |
| **Executable contracts** | ✓ 9 dimensions | ✓ 7 dimensions | Light |
| **Safeguards** | ✓ Explicit constraints | ✓ Explicit constraints | Checklist |
| **Diagrams** | ✓ Plain text (no Mermaid) | Mermaid | Mermaid |
| **Bidirectional sync** | Planned | ✓ `/spdd-sync` | ✗ |
| **Risk assessment** | ✓ Required | ✗ | Optional |

## Learn More

- [Design Philosophy](docs/design-philosophy.md) — Why PDD exists
- [Examples](skills/pdd/references/examples.md) — Filled-out canvases
- [Review Checklist](skills/pdd/references/review-checklist.md) — Agent-readiness validation

## License

MIT
