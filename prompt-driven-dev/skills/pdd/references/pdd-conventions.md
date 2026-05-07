# PDD Conventions

## Directory Structure

```
project/
├── docs/
│   └── pdd/
│       ├── README.md                    # Index of all canvases
│       ├── 0001-add-rate-limiting.md
│       ├── 0002-migrate-to-jwt.md
│       └── spikes/
│           ├── 0001-rate-limiting-research.md
│           └── 0002-jwt-evaluation.md
├── src/
│   └── ...
```

## Naming Conventions

### Canvas Files

- **Pattern:** `{NNNN}-{kebab-case-title}.md`
- **Examples:** `0001-add-rate-limiting.md`, `0002-migrate-to-jwt.md`
- **Numbering:** Sequential, zero-padded to 4 digits

### Spike Files

- **Pattern:** `{NNNN}-{kebab-case-title}-research.md`
- **Examples:** `0001-rate-limiting-research.md`
- **Link to:** Parent canvas (if applicable)

## Status Values

### Canvas Status

| Status | Meaning |
|--------|---------|
| `proposed` | Under review, not yet approved |
| `active` | Approved, implementation in progress |
| `completed` | Implementation done and verified |
| `superseded by PDD-NNNN` | Replaced by a newer canvas |

### Spike Status

| Status | Meaning |
|--------|---------|
| `in-progress` | Spike is being investigated |
| `completed` | Spike finished, findings documented |
| `abandoned` | Spike stopped early (document why) |

## YAML Front Matter

Every canvas and spike must have YAML front matter:

```yaml
---
status: proposed
date: 2026-05-01
authors:
  - Wayan
timebox: 3
---
```

### Required Fields

- `status` — Current status
- `date` — Creation date (YYYY-MM-DD)

### Optional Fields

- `authors` — People involved
- `timebox` — Estimated days for spike
- `canvas` — Link to parent PDD canvas (for spikes)

## Code ↔ Canvas Linking

### In Code

Reference the governing canvas in comments:

```typescript
// PDD-0001: Use sliding window rate limiting
// See: docs/pdd/0001-add-rate-limiting.md
export function rateLimit() { ... }
```

### In Canvas

Reference specific files in the codebase:

```markdown
### Files Affected

- `src/middleware/rateLimiter.ts` (new)
- `src/config/rateLimit.ts` (new)
- `src/middleware/index.ts` (modify)
```

## T-Shirt Size Guide

| Size | Description | Time Estimate |
|------|-------------|---------------|
| **S** | Small | < 1 day |
| **M** | Medium | 1-2 days |
| **L** | Large | 3-5 days |
| **XL** | Extra Large | 5+ days (consider splitting) |

## Diagram Conventions

**All diagrams must be readable as plain text.** No Mermaid, no external renderers.

### Architecture Diagrams

Use ASCII art in code blocks. Keep them simple and focused:

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

**Tips:**
- Use `│`, `─`, `▶`, `▼` for connections
- Keep to ~15 lines max
- If larger, split by layer or component

### Data Flows

Use numbered steps. Split into multiple flows if complex:

```markdown
#### Flow 1: Login

1. Client sends `POST /api/auth/login` with credentials
2. Gateway forwards to Auth Service
3. Auth Service verifies against database
4. Auth Service generates JWT tokens
5. Gateway returns tokens to client

#### Flow 2: Token Validation

1. Client sends request with Bearer token
2. Gateway extracts token
3. Gateway checks Redis blacklist
4. Gateway verifies signature
5. Gateway forwards to target service
```

**Tips:**
- One flow per use case (login, logout, etc.)
- Keep each flow to ~10 steps max
- Use bold for key actions or decisions

### Entities

Use indented lists with method signatures:

```markdown
### User

- `id: string` — Unique identifier
- `email: string` — User email
- `roles: Role[]` — Assigned roles
- `createToken(): TokenPair` — Generate JWT pair

### TokenService

- `generateToken(user: User): Token` — Create access token
- `validateToken(token: string): boolean` — Verify token
- `revokeToken(jti: string): void` — Blacklist token
```

### Relationships

Use tables for connections between entities:

```markdown
| From | Relationship | To | Notes |
|------|--------------|----|-------|
| User | has many | Role | Via junction table |
| TokenService | uses | Redis | For blacklist |
| Gateway | forwards to | Auth Service | Token ops |
```

### When to Split Diagrams

Split if:
- Architecture diagram > 15 lines → Split by layer (client, gateway, service, data)
- Data flow > 10 steps → Split by use case
- Entities > 5 classes → Split by domain (auth, billing, notifications)

### Why Plain Text?

| Mermaid | Plain Markdown |
|---------|----------------|
| Requires renderer | Works everywhere |
| Hard to review in PRs | Easy to review |
| Single large diagram | Split into multiple |
| Complex syntax | Simple, readable |

## Review Process

1. **Self-review:** Author checks against review checklist
2. **Peer review:** At least one other developer reviews
3. **Approval:** Canvas status changes to `active`
4. **Implementation:** AI generates code from canvas
5. **Verification:** Check against verification criteria
6. **Completion:** Status changes to `completed`
