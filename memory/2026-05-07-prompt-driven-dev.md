# PDD Session Handoff

**Date:** 2026-05-07
**Project:** Prompt Driven Development (PDD)
**Location:** `/home/jimbo/clones/labs/agent-stuff/prompt-driven-dev/`

---

## Session Summary

Built a new coding agent skill called **Prompt Driven Development (PDD)** that combines:
- **OpenSPDD's** executable design contracts (REASONS Canvas)
- **Spike Document Guide's** research-first methodology
- Plain text diagrams (no Mermaid)
- Hidden `.pdd/` directory
- Deno scripts (not Node.js)

---

## Background: What We Studied

### 1. OpenSPDD (https://github.com/gszhangwei/open-spdd)

A structured prompt-driven development methodology with:

- **REASONS Canvas** (7 dimensions): Requirements, Entities, Approach, Structure, Operations, Norms, Safeguards
- **Key insight:** "Plan is a suggestion, REASONS Canvas is a contract"
- **Safeguards:** Explicit "DO NOT" rules that prevent AI from improvising
- **Bidirectional sync:** `/spdd-sync` keeps design docs and code in sync

### 2. Spike Document Guide (https://blog.wayanjim.my.id/en/posts/spike-document-guide)

A research-first approach to technical discovery:

- **Time-boxed investigation:** 1-5 days
- **Deliverables:** Technical approach, task breakdown, PoC, architecture diagrams, risk assessment
- **T-shirt sizing:** S/M/L for tasks
- **Key insight:** "Spikes are collaborative, not solo activities"

---

## What We Built: PDD

### The 9-Dimension Canvas

```
P - Purpose        Why this exists (business context)
S - Spike Findings Research results, PoC validation
A - Approach       Strategy & trade-offs considered
R - Requirements   Functional + non-functional requirements
T - Tasks          Breakdown with T-shirt sizes
E - Entities       Domain model (indented lists with signatures)
D - Design         Architecture, patterns, structure
R - Risks          Blockers, mitigations, fallbacks
S - Safeguards     Constraints — what must NOT be done
```

### The 5-Phase Workflow

```
Phase 0: Scan the Codebase
Phase 1: Capture Intent (Socratic questioning)
Phase 2: Spike (time-boxed research + PoC)
Phase 3: Draft the PDD Canvas
Phase 4: Review (agent-readiness checklist)
Phase 5: Sync (bidirectional code ↔ canvas)
```

### Project Structure

```
prompt-driven-dev/
├── README.md
├── install.sh
├── docs/
│   └── design-philosophy.md
└── skills/pdd/
    ├── SKILL.md
    ├── deno.json
    ├── assets/templates/
    │   ├── pdd-canvas.md
    │   ├── pdd-spike.md
    │   └── pdd-simple.md
    ├── references/
    │   ├── examples.md
    │   ├── pdd-conventions.md
    │   └── review-checklist.md
    └── scripts/
        ├── utils.ts
        ├── bootstrap_pdd.ts
        ├── new_canvas.ts
        ├── new_spike.ts
        └── sync_canvas.ts
```

---

## Key Decisions Made

### 1. Plain Text Diagrams (No Mermaid)

**Decision:** Use ASCII art and numbered steps instead of Mermaid diagrams.

**Why:**
- Readable anywhere (terminal, editors, GitHub raw view)
- No renderer required
- Easy to review in PRs
- Naturally split when large

**Examples:**
- Architecture: ASCII art in code blocks
- Data flows: Numbered steps
- Entities: Indented lists with method signatures
- Relationships: Tables

### 2. Hidden `.pdd/` Directory

**Decision:** Use `.pdd/` instead of `docs/pdd/`.

**Why:**
- Hidden by default (less clutter)
- Consistent with `.cursor/`, `.pi/`, `.github/`
- Looks like tooling, not documentation
- Separate concern from user docs

### 3. Deno Scripts (Not Node.js)

**Decision:** Use TypeScript with Deno runtime.

**Why:**
- TypeScript by default (no config needed)
- Built-in permissions model
- No node_modules
- Standard library instead of npm packages

### 4. Task Table with "Done" Column

**Decision:** Add `Done` column to Tasks table.

**Why:**
- Enables sync feature to mark completed tasks
- Clear visibility of progress
- Fixes Gemini's review issue with table sync

---

## Gemini Review & Fixes

### Issues Found

1. **CRITICAL BUG:** `findProjectRoot` was not `async` but used `await`
2. **DRY violation:** `exists()` and `findProjectRoot()` duplicated in every script
3. **Sync bug:** Table column logic would break markdown tables
4. **Hardcoded templates:** Templates were inline, not loaded from files

### Fixes Applied

1. ✅ Created `utils.ts` with shared functions
2. ✅ All scripts now use proper `async/await`
3. ✅ Added "Done" column to task tables
4. ✅ Templates loaded from `assets/templates/`

### Gemini's Final Verdict

> "The implementation is now high-quality and meets all the requirements. I recommend proceeding with these changes."

---

## Usage

### Install

```bash
cd prompt-driven-dev
./install.sh           # Auto-detect agent
./install.sh pi        # Pi only
./install.sh gemini    # Gemini only
```

### Commands

```bash
cd skills/pdd

# Bootstrap PDD structure in a project
deno task bootstrap

# Create a spike (research)
deno task new-spike "Evaluate JWT auth"
deno task new-spike --canvas 0001 "Rate limiting research"

# Create a canvas (implementation contract)
deno task new-canvas "Implement JWT auth"
deno task new-canvas-simple "Fix login bug"

# Sync canvas with code
deno task sync 0001
deno task sync-dry 0001
deno task sync --all
```

### Generated Files

```
your-project/
├── .pdd/
│   ├── README.md
│   ├── 0001-implement-jwt.md      # Canvas
│   └── spikes/
│       └── 0001-jwt-research.md   # Spike
└── src/
    └── ...
```

---

## Agent Support

| Agent | Location | Status |
|-------|----------|--------|
| Pi | `.pi/skills/pdd/` | ✅ Primary |
| Gemini | `.agents/skills/pdd/` | ✅ Supported |
| Claude | `.claude/skills/pdd/` | ✅ Supported |
| Cursor | `.cursor/skills/pdd/` | ✅ Supported |

---

## Comparison with OpenSPDD

| Feature | PDD | OpenSPDD |
|---------|-----|----------|
| **Dimensions** | 9 | 7 |
| **Research phase** | ✓ Spike documents | ✗ |
| **PoC validation** | ✓ Built-in | ✗ |
| **T-shirt estimates** | ✓ Required | ✗ |
| **Diagrams** | Plain text | Mermaid |
| **Directory** | `.pdd/` | Configurable |
| **Scripts** | Deno | Node.js |
| **Bidirectional sync** | ✓ Implemented | ✓ `/spdd-sync` |

---

## Future Improvements

1. **Multi-language sync:** Extend regex to handle Go, Rust, Python
2. **`deno task check`:** Automated validator against review checklist
3. **Canvas versioning:** Track changes over time
4. **Integration with git hooks:** Auto-sync on commit
5. **VS Code extension:** Visual canvas editor

---

## Files to Know

| File | Purpose |
|------|---------|
| `skills/pdd/SKILL.md` | Main skill definition (read this first) |
| `skills/pdd/scripts/utils.ts` | Shared utilities |
| `skills/pdd/scripts/sync_canvas.ts` | Most complex script |
| `skills/pdd/assets/templates/pdd-canvas.md` | Full canvas template |
| `skills/pdd/references/examples.md` | Filled-out examples |
| `install.sh` | Multi-agent installer |

---

## Contact

Created by MiMo (Xiaomi LLM Core Team) with Gemini review.

Session: 2026-05-07
Repository: `/home/jimbo/clones/labs/agent-stuff/prompt-driven-dev/`
