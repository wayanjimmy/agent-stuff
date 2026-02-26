export interface ApiKeyState {
  key: string;
  lastUsed: number;
  failureCount: number;
  cooldownUntil: number;
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
    const uniqueKeys = [...new Set(config.keys.filter(k => k.trim().length > 0))];

    if (uniqueKeys.length === 0) {
      throw new Error("At least one API key is required");
    }

    this.keys = uniqueKeys.map(key => ({
      key: key.trim(),
      lastUsed: 0,
      failureCount: 0,
      cooldownUntil: 0,
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
    const keyState = this.keys.find(k => k.key === key);
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
    const keyState = this.keys.find(k => k.key === key);
    if (!keyState) return false;

    keyState.failureCount++;

    // Rate limit (429) or auth error (401) - put in cooldown
    if (statusCode === 429 || statusCode === 401) {
      keyState.cooldownUntil = Date.now() + this.cooldownMs;
    }

    // Check if we have other available keys
    const now = Date.now();
    const hasOtherKeys = this.keys.some(k =>
      k.key !== key && (now >= k.cooldownUntil && k.failureCount < this.maxFailures)
    );

    return hasOtherKeys;
  }

  /**
   * Get the number of available (non-cooldown) keys
   */
  getAvailableKeyCount(): number {
    const now = Date.now();
    return this.keys.filter(k => now >= k.cooldownUntil && k.failureCount < this.maxFailures).length;
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
  }> {
    const now = Date.now();
    return this.keys.map((k, i) => ({
      index: i,
      maskedKey: maskKey(k.key),
      available: now >= k.cooldownUntil && k.failureCount < this.maxFailures,
      failureCount: k.failureCount,
      inCooldown: now < k.cooldownUntil,
    }));
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
  return envKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

/**
 * Create an ApiKeyManager from environment variables
 */
export function createApiKeyManager(
  maxFailures?: number,
  cooldownMs?: number
): ApiKeyManager | undefined {
  const keys = loadApiKeys();

  if (keys.length === 0) {
    return undefined;
  }

  return new ApiKeyManager({ keys, maxFailures, cooldownMs });
}
