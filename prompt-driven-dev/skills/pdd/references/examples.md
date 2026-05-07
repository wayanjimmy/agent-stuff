# PDD Canvas Examples

## Short Example (Simple Canvas)

### PDD-0001: Add rate limiting to API endpoints

## Purpose

Our API has no rate limiting. Competitors are scraping our data, and we're getting 10x normal traffic from a few IP addresses. We need to protect our infrastructure while maintaining good UX for legitimate users.

## Approach

Use a sliding window rate limiter with Redis backend. This allows distributed rate limiting across multiple API servers and provides accurate counting.

## Requirements

- [ ] Rate limit by IP address (default: 100 requests/minute)
- [ ] Return HTTP 429 with Retry-After header when limit exceeded
- [ ] Allow per-endpoint configuration via config file
- [ ] Log rate limit hits for monitoring

## Tasks

| # | Task | Size | Files |
|---|------|------|-------|
| 1 | Create rate limiter module | M | `src/middleware/rateLimiter.ts` |
| 2 | Add Redis client config | S | `src/config/redis.ts` |
| 3 | Create middleware | S | `src/middleware/index.ts` |
| 4 | Add unit tests | S | `src/middleware/__tests__/rateLimiter.test.ts` |
| 5 | Update API docs | S | `docs/api/rate-limiting.md` |

## Design

### Pattern

Follow existing middleware pattern in `src/middleware/auth.ts`:
- Export as named function
- Accept options object
- Return Express middleware

### Configuration

```typescript
// src/config/rateLimit.ts
export const rateLimitConfig = {
  default: { windowMs: 60000, max: 100 },
  endpoints: {
    '/api/search': { windowMs: 60000, max: 20 },
    '/api/export': { windowMs: 300000, max: 5 },
  }
}
```

## Safeguards

- ❌ **DO NOT** store rate limit state in memory (must use Redis)
- ❌ **DO NOT** apply rate limiting to health check endpoints
- ❌ **DO NOT** block users permanently — always use sliding window

## Verification

- [ ] Unit tests pass: `npm test src/middleware/rateLimiter`
- [ ] Manual test: Send 101 requests, verify 429 on 101st
- [ ] Verify Retry-After header is present in 429 response

---

## Long Example (Full Canvas)

### PDD-0002: Migrate authentication from session-based to JWT

## P — Purpose

We're moving from monolith to microservices. Session-based auth requires sticky sessions or shared session store, which creates tight coupling. JWT allows each service to validate tokens independently, enabling stateless services.

Current pain points:
- Session store costs $500/month at current scale
- Adding a new service requires session replication setup
- Mobile clients handle tokens better than cookies

**Business context:** Q2 initiative to split monolith into 3 services. Auth migration is a prerequisite.

## S — Spike Findings

### Technologies Evaluated

**Option A: JWT with RSA keys**
- Pros: Stateless, no shared storage, industry standard
- Cons: Can't revoke tokens without additional mechanism
- PoC Result: Successfully validated — tokens verify in <1ms

**Option B: Opaque tokens with Redis**
- Pros: Easy revocation, familiar pattern
- Cons: Still requires Redis, adds latency for lookup
- PoC Result: Works but adds 5-10ms per request

**Option C: JWT + Redis blacklist**
- Pros: Stateless validation + revocation capability
- Cons: Complexity of managing blacklist
- PoC Result: Optimal balance of performance and control

### PoC Validation

```typescript
// src/auth/jwt-validator.ts
import jwt from 'jsonwebtoken';
import { redis } from '../config/redis';

export async function validateToken(token: string): Promise<User | null> {
  try {
    const payload = jwt.verify(token, PUBLIC_KEY) as JwtPayload;
    
    // Check blacklist for revoked tokens
    const isBlacklisted = await redis.get(`bl:${payload.jti}`);
    if (isBlacklisted) return null;
    
    return payload.user;
  } catch {
    return null;
  }
}
```

### Results

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| Validation time | <5ms | 2.3ms | ✓ |
| Token size | <1KB | 847 bytes | ✓ |
| Blacklist lookup | <10ms | 4.2ms | ✓ |

## A — Approach

**Chosen:** JWT + Redis blacklist

**Rationale:**
- Stateless validation for performance
- Redis blacklist for immediate revocation (logout, password change)
- Short token expiry (15 min) limits blast radius

### Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| JWT + RSA | Pure stateless | No revocation | ✗ |
| Opaque + Redis | Simple revocation | Redis dependency always | ✗ |
| JWT + Blacklist | Best of both | Slight complexity | ✓ |

## R — Requirements

### Functional

- [ ] Users receive JWT on login (15 min expiry)
- [ ] Refresh tokens rotate every 7 days
- [ ] Logout adds token to blacklist
- [ ] Password change invalidates all refresh tokens
- [ ] Token contains user ID, email, roles

### Non-Functional

- [ ] Token validation <5ms
- [ ] Support 10,000 concurrent users
- [ ] Blacklist TTL matches token expiry
- [ ] Zero downtime migration from sessions

## T — Tasks

| # | Task | Size | Dependencies | Files |
|---|------|------|--------------|-------|
| 1 | Generate RSA key pair | S | — | `scripts/generate-keys.sh` |
| 2 | Create token service | M | #1 | `src/auth/tokenService.ts` |
| 3 | Create blacklist service | S | — | `src/auth/blacklistService.ts` |
| 4 | Update login endpoint | M | #2 | `src/routes/auth.ts` |
| 5 | Create auth middleware | M | #2, #3 | `src/middleware/auth.ts` |
| 6 | Add refresh token flow | L | #2, #5 | `src/routes/auth.ts` |
| 7 | Migration script | M | #4 | `scripts/migrate-sessions.ts` |
| 8 | Integration tests | L | #4, #5, #6 | `tests/auth/` |

## E — Entities

### TokenService

- `generateTokenPair(user: User): TokenPair` — Creates access + refresh tokens
- `validateToken(token: string): TokenPayload | null` — Verifies and decodes token
- `revokeToken(jti: string): void` — Adds token to blacklist
- `-signToken(payload: JwtPayload): string` — Signs token with private key

### BlacklistService

- `add(jti: string, ttl: number): Promise<void>` — Add token ID to blacklist
- `isBlacklisted(jti: string): Promise<boolean>` — Check if token is revoked
- `-cleanup(): void` — Remove expired entries

### TokenPair

- `accessToken: string` — Short-lived JWT (15 min)
- `refreshToken: string` — Long-lived token (7 days)
- `expiresAt: Date` — Access token expiry

### JwtPayload

- `sub: string` — User ID
- `email: string` — User email
- `roles: string[]` — User roles
- `jti: string` — Unique token ID
- `exp: number` — Expiry timestamp

### Relationships

| From | Relationship | To | Notes |
|------|--------------|----|-------|
| TokenService | uses | BlacklistService | For revocation |
| TokenService | generates | TokenPair | On login |
| TokenService | creates | JwtPayload | In token |
| Client | sends to | API Gateway | All requests |
| API Gateway | checks | Redis | Blacklist |
| API Gateway | forwards to | Auth Service | Token operations |

## D — Design

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│   Client    │────▶│  API Gateway │────▶│  Redis  │
│             │◀────│              │◀────│         │
└─────────────┘     └──────────────┘     └─────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Auth Service│
                    │  (JWT + RSA) │
                    └──────────────┘
```

### Patterns to Follow

- **Error handling:** Follow pattern in `src/routes/users.ts` — typed errors with HTTP status codes
- **Logging:** Use `logger` from `src/utils/logger.ts` — structured JSON logs
- **Validation:** Use `zod` schemas in `src/validation/auth.ts`

### Configuration

```typescript
// src/config/auth.ts
export const authConfig = {
  jwt: {
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    algorithm: 'RS256',
  },
  blacklist: {
    prefix: 'bl:',
    defaultTtl: 900, // 15 minutes
  },
  keys: {
    privatePath: process.env.JWT_PRIVATE_KEY_PATH,
    publicPath: process.env.JWT_PUBLIC_KEY_PATH,
  }
}
```

### Data Flow

#### Flow 1: Login

1. Client sends `POST /api/auth/login` with credentials
2. Gateway forwards to Auth Service
3. Auth Service verifies credentials against database
4. Auth Service generates JWT token pair
5. Auth Service stores refresh token hash in Redis
6. Gateway returns tokens to client

#### Flow 2: Protected Request

1. Client sends request with `Authorization: Bearer <token>`
2. Gateway extracts token from header
3. Gateway checks Redis blacklist for token ID
4. If blacklisted → return 401
5. Gateway verifies JWT signature with public key
6. If invalid → return 401
7. Gateway forwards request to target service with decoded user info

#### Flow 3: Logout

1. Client sends `POST /api/auth/logout` with token
2. Gateway extracts token ID (jti)
3. Gateway adds jti to Redis blacklist with TTL matching token expiry
4. Gateway returns 200

## R — Risks

| Risk | Likelihood | Impact | Mitigation | Fallback |
|------|-----------|--------|------------|----------|
| Key compromise | Low | Critical | HSM storage, key rotation | Revoke all tokens, force re-login |
| Redis failure | Medium | High | Redis Sentinel, connection pooling | Fail open (allow requests) |
| Clock skew | Low | Medium | NTP sync, 30s tolerance | Extended expiry window |
| Migration downtime | Medium | Medium | Blue-green deployment, feature flag | Rollback to sessions |

## S — Safeguards

### Code Constraints

- ❌ **DO NOT** use HS256 (symmetric) — must use RS256 (asymmetric)
- ❌ **DO NOT** store tokens in localStorage — use httpOnly cookies only
- ❌ **DO NOT** include sensitive data in JWT payload (no passwords, no PII beyond email)

### Security Constraints

- ❌ **DO NOT** allow token refresh if refresh token is blacklisted
- ❌ **DO NOT** skip blacklist check even if signature is valid
- ❌ **DO NOT** log token contents — only log token ID (jti)

### Migration Constraints

- ❌ **DO NOT** deploy JWT auth until session fallback is ready
- ❌ **DO NOT** remove session code until 100% traffic is on JWT
- ❌ **DO NOT** skip A/B testing during migration

## Verification

### Unit Tests

- [ ] Token generation with valid user
- [ ] Token validation with valid token
- [ ] Token validation with expired token
- [ ] Token validation with blacklisted token
- [ ] Blacklist add and check

### Integration Tests

- [ ] Login returns token pair
- [ ] Protected endpoint accepts valid token
- [ ] Protected endpoint rejects expired token
- [ ] Logout blacklists token
- [ ] Refresh token rotation

### Manual Verification

- [ ] Login via Postman, verify token in response
- [ ] Use token to access protected endpoint
- [ ] Logout, verify token is rejected
- [ ] Wait 15 minutes, verify token expires

## Footer

### Related Documents

- PDD-0001: Rate Limiting (prerequisite)
- ADR-0003: Session Store Migration

### Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-05-01 | Initial spike | Wayan |
| 2026-05-03 | PoC validated | Wayan |
| 2026-05-05 | Canvas complete | Wayan |
