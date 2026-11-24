import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../../common/rate-limit/rate-limiter';
import { signWebhookPayload, verifyWebhookSignature } from '../webhooks/webhooks.service';

describe('FixedWindowLimiter', () => {
  it('allows up to the max, then blocks with a Retry-After', () => {
    const limiter = new FixedWindowLimiter(3, 60_000);
    expect(limiter.check('tenant:t1:1.2.3.4', 0).allowed).toBe(true);
    expect(limiter.check('tenant:t1:1.2.3.4', 1_000).allowed).toBe(true);
    expect(limiter.check('tenant:t1:1.2.3.4', 2_000).allowed).toBe(true);
    const blocked = limiter.check('tenant:t1:1.2.3.4', 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('resets when the window elapses and isolates keys', () => {
    const limiter = new FixedWindowLimiter(1, 10_000);
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 5_000).allowed).toBe(false);
    expect(limiter.check('b', 5_000).allowed).toBe(true); // different key, own budget
    expect(limiter.check('a', 10_000).allowed).toBe(true); // new window
  });
});

describe('webhook HMAC signing', () => {
  it('signs and verifies, and rejects a tampered body or wrong secret', () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ deliveryId: 'd1', eventType: 'sales-invoice.posted', payload: { id: 'x' } });
    const sig = signWebhookPayload(secret, body);
    expect(sig.startsWith('sha256=')).toBe(true);
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, body.replace('posted', 'voided'), sig)).toBe(false);
    expect(verifyWebhookSignature('other-secret', body, sig)).toBe(false);
  });
});
