export interface ApiKeyState {
  key: string;
  lastUsed: number;
  failureCount: number;
  cooldownUntil: number;
  requestsMade: number;
  rateLimitRemaining?: number;
  rateLimitTotal?: number;
  plan?: string;
}

export interface ApiKeyManagerConfig {
  keys: string[];
  maxFailures?: number;
  cooldownMs?: number;
}

export class ApiKeyManager {
  private keys: ApiKeyState[];
  private currentIndex: number;
  private maxFailures: number;
  private cooldownMs: number;

  constructor(config: ApiKeyManagerConfig) {
    const uniqueKeys = [...new Set(config.keys.filter((k) => k.trim().length > 0))];

    if (uniqueKeys.length === 0) {
      throw new Error("At least one API key is required");
    }

    this.keys = uniqueKeys.map((key) => ({
      key: key.trim(),
      lastUsed: 0,
      failureCount: 0,
      cooldownUntil: 0,
      requestsMade: 0,
    }));

    this.currentIndex = 0;
    this.maxFailures = config.maxFailures ?? 3;
    this.cooldownMs = config.cooldownMs ?? 60000; // 1 minute default cooldown
  }

  /**
   * Get the next available API key using round-robin with health checks
   */
  getNextKey(): string | undefined {
    const now = Date.now();
    const startIndex = this.currentIndex;

    // Try to find a healthy key
    for (let i = 0; i < this.keys.length; i++) {
      const index = (startIndex + i) % this.keys.length;
      const keyState = this.keys[index];

      // Check if key is available (not in cooldown)
      if (now >= keyState.cooldownUntil && keyState.failureCount < this.maxFailures) {
        this.currentIndex = (index + 1) % this.keys.length;
        keyState.lastUsed = now;
        return keyState.key;
      }
    }

    // All keys are unhealthy - reset the first one and use it as last resort
    if (this.keys.length > 0) {
      const keyState = this.keys[0];
      keyState.failureCount = 0;
      keyState.cooldownUntil = 0;
      keyState.lastUsed = now;
      this.currentIndex = 1 % this.keys.length;
      return keyState.key;
    }

    return undefined;
  }

  /**
   * Report a successful request for the given key
   */
  reportSuccess(key: string): void {
    const keyState = this.keys.find((k) => k.key === key);
    if (keyState) {
      keyState.failureCount = 0;
      keyState.cooldownUntil = 0;
    }
  }

  /**
   * Report a failure for the given key
   * Returns true if we should retry with another key
   */
  reportFailure(key: string, statusCode?: number): boolean {
    const keyState = this.keys.find((k) => k.key === key);
    if (!keyState) return false;

    keyState.failureCount++;

    // Rate limit (429) or auth error (401) - put in cooldown
    if (statusCode === 429 || statusCode === 401) {
      keyState.cooldownUntil = Date.now() + this.cooldownMs;
    }

    // Check if we have other available keys
    const now = Date.now();
    const hasOtherKeys = this.keys.some(
      (k) => k.key !== key && now >= k.cooldownUntil && k.failureCount < this.maxFailures,
    );

    return hasOtherKeys;
  }

  /**
   * Get the number of available (non-cooldown) keys
   */
  getAvailableKeyCount(): number {
    const now = Date.now();
    return this.keys.filter((k) => now >= k.cooldownUntil && k.failureCount < this.maxFailures)
      .length;
  }

  /**
   * Get total number of keys
   */
  getTotalKeyCount(): number {
    return this.keys.length;
  }

  /**
   * Get current status of all keys with masked key values
   */
  getKeyStatus(): Array<{
    index: number;
    maskedKey: string;
    available: boolean;
    failureCount: number;
    inCooldown: boolean;
    requestsMade: number;
    rateLimitRemaining?: number;
    rateLimitTotal?: number;
    cooldownRemainingMs?: number;
    plan?: string;
  }> {
    const now = Date.now();
    return this.keys.map((k, i) => ({
      index: i,
      maskedKey: maskKey(k.key),
      available: now >= k.cooldownUntil && k.failureCount < this.maxFailures,
      failureCount: k.failureCount,
      inCooldown: now < k.cooldownUntil,
      requestsMade: k.requestsMade,
      rateLimitRemaining: k.rateLimitRemaining,
      rateLimitTotal: k.rateLimitTotal,
      cooldownRemainingMs: now < k.cooldownUntil ? k.cooldownUntil - now : undefined,
      plan: k.plan,
    }));
  }

  /**
   * Get usage stats for a specific key
   */
  getUsageStats(key: string): { requests: number; remaining?: number; total?: number } {
    const keyState = this.keys.find((k) => k.key === key);
    if (!keyState) {
      return { requests: 0 };
    }
    return {
      requests: keyState.requestsMade,
      remaining: keyState.rateLimitRemaining,
      total: keyState.rateLimitTotal,
    };
  }

  /**
   * Update rate limit info from API response headers
   */
  updateRateLimit(key: string, remaining: number, total: number): void {
    const keyState = this.keys.find((k) => k.key === key);
    if (keyState) {
      keyState.rateLimitRemaining = remaining;
      keyState.rateLimitTotal = total;
    }
  }

  /**
   * Increment request count for a key
   */
  incrementRequests(key: string): void {
    const keyState = this.keys.find((k) => k.key === key);
    if (keyState) {
      keyState.requestsMade++;
    }
  }

  /**
   * Fetch usage data from Tavily API for a specific key
   * Uses the /usage endpoint documented at:
   * https://docs.tavily.com/documentation/api-reference/endpoint/usage
   */
  async fetchUsageForKey(key: string): Promise<boolean> {
    const keyState = this.keys.find((k) => k.key === key);
    if (!keyState) {
      return false;
    }

    try {
      const response = await fetch("https://api.tavily.com/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        console.log(`[Web Search] Usage fetch failed for key: ${response.status}`);
        return false;
      }

      const data = (await response.json()) as TavilyUsageResponse;

      // Update rate limit info from the usage data
      // The API returns usage and limit for the current period
      // key.limit can be null (unlimited), fall back to account.plan_limit
      const limit = data.key.limit ?? data.account.plan_limit ?? 1000;
      if (limit > 0) {
        keyState.rateLimitTotal = limit;
        keyState.rateLimitRemaining = Math.max(0, limit - data.key.usage);
      }

      // Store plan name from account data
      keyState.plan = data.account.current_plan;

      return true;
    } catch (error) {
      console.log(`[Web Search] Usage fetch error:`, error);
      return false;
    }
  }

  /**
   * Fetch usage data for all keys concurrently
   */
  async fetchAllUsage(): Promise<void> {
    const promises = this.keys.map((k) => this.fetchUsageForKey(k.key));
    await Promise.all(promises);
  }
}

/**
 * Mask an API key for display (show first 4 and last 4 chars)
 */
function maskKey(key: string): string {
  if (key.length <= 8) {
    return "****";
  }
  return key.substring(0, 4) + "..." + key.substring(key.length - 4);
}

/**
 * Load API keys from TAVILY_API_KEYS environment variable (comma-separated)
 */
export function loadApiKeys(): string[] {
  const envKeys = process.env.TAVILY_API_KEYS;
  if (!envKeys) {
    return [];
  }
  return envKeys
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Create an ApiKeyManager from environment variables
 */
export function createApiKeyManager(
  maxFailures?: number,
  cooldownMs?: number,
): ApiKeyManager | undefined {
  const keys = loadApiKeys();

  if (keys.length === 0) {
    return undefined;
  }

  return new ApiKeyManager({ keys, maxFailures, cooldownMs });
}

/**
 * Get or create a shared singleton instance of the ApiKeyManager
 * This ensures that usage data persists across searches and status checks
 */
let sharedManager: ApiKeyManager | undefined = undefined;

export function getSharedApiKeyManager(
  maxFailures?: number,
  cooldownMs?: number,
): ApiKeyManager | undefined {
  if (sharedManager) {
    return sharedManager;
  }
  sharedManager = createApiKeyManager(maxFailures, cooldownMs);
  return sharedManager;
}

export function resetSharedApiKeyManager(): void {
  sharedManager = undefined;
}

/**
 * Tavily Usage API Types
 * Based on https://docs.tavily.com/documentation/api-reference/endpoint/usage
 */
export interface TavilyUsageData {
  usage: number;
  limit: number | null;
  search_usage: number;
  extract_usage: number;
  crawl_usage: number;
  map_usage: number;
  research_usage: number;
}

export interface TavilyAccountData {
  current_plan: string;
  plan_usage: number;
  plan_limit: number;
  paygo_usage: number;
  paygo_limit: number;
  search_usage: number;
  extract_usage: number;
  crawl_usage: number;
  map_usage: number;
  research_usage: number;
}

export interface TavilyUsageResponse {
  key: TavilyUsageData;
  account: TavilyAccountData;
}
