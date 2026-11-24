/**
 * Phase 11 — rate limiting (closes the Phase 0 security.md gap).
 *
 * In-memory fixed-window counter. One bucket per key (tenant + IP for JWT
 * requests, API-key id for key requests, bare IP for public routes). The
 * store is per-process: with a single API replica (the Phase 0 deployment
 * shape) that is exact; with multiple replicas a tenant could exceed the
 * limit by up to N× — the documented production hardening is to back this
 * with Redis (already in the stack for BullMQ). Limits come from env:
 * RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS (default 600 / 60s) and
 * API_KEY_RATE_LIMIT_MAX / API_KEY_RATE_LIMIT_WINDOW_SECONDS (300 / 60s).
 * Exceeding the limit returns 429 with a Retry-After header.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** Returns `{ allowed, retryAfterSeconds }`. */
  check(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const bucket = this.buckets.get(key);
    if (!bucket || nowMs - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: nowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count < this.max) {
      bucket.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds = Math.ceil((bucket.windowStart + this.windowMs - nowMs) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  reset(): void {
    this.buckets.clear();
  }
}
