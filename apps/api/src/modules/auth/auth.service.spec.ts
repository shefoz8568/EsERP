import { describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AuthService } from './auth.service';

function makeService(prismaClient: any) {
  const config = { get: (key: string) => ({ jwtAccessSecret: 'test-access', jwtRefreshSecret: 'test-refresh', jwtAccessTtlSeconds: 900, jwtRefreshTtlSeconds: 2592000 })[key] } as any;
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as any;
  const outbox = { publish: vi.fn().mockResolvedValue(undefined) } as any;
  const prisma = {
    client: prismaClient,
    // withTenant/withBootstrap run the callback against the mock client.
    withTenant: async (_tid: string, fn: (tx: any) => Promise<unknown>) => fn(prismaClient),
    withBootstrap: async (fn: (tx: any) => Promise<unknown>) => fn(prismaClient),
  } as any;
  return new AuthService(prisma, new JwtService({}), config, audit, outbox);
}

describe('AuthService', () => {
  it('hashes and verifies passwords with argon2', async () => {
    const hash = await argon2.hash('Demo1234!');
    expect(await argon2.verify(hash, 'Demo1234!')).toBe(true);
    expect(await argon2.verify(hash, 'wrong')).toBe(false);
  });

  it('refresh rotation revokes the old token', async () => {
    const store: any[] = [];
    const prismaClient = {
      refreshToken: {
        create: vi.fn(async ({ data }: any) => { const row = { id: `rt-${store.length}`, ...data, revokedAt: null }; store.push(row); return row; }),
        findMany: vi.fn(async () => store.filter((r) => !r.revokedAt)),
        update: vi.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id)!; Object.assign(row, data); return row; }),
      },
      user: { findUnique: vi.fn(async () => ({ id: 'u1', tenantId: 't1', email: 'a@b.c', userRoles: [] })) },
    };
    const svc = makeService(prismaClient);
    const pair1 = await svc.issueTokens('u1', 't1', 'a@b.c', []);
    expect(store).toHaveLength(1);
    const pair2 = await svc.refresh(pair1.refreshToken);
    expect(store[0].revokedAt).not.toBeNull(); // old token revoked
    expect(pair2.refreshToken).not.toBe(pair1.refreshToken);
    // Replaying the old refresh token must now fail.
    await expect(svc.refresh(pair1.refreshToken)).rejects.toThrow();
  });

  it('TOTP setup/verify round-trips with otplib', async () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    expect(authenticator.check(code, secret)).toBe(true);
    expect(authenticator.check('000000', secret)).toBe(false);
    // Full service flow: setup returns a signed setup token + QR, verify stores the secret.
    const db: any = { mfa: null, user: { id: 'u1', tenantId: 't1', email: 'a@b.c' } };
    const prismaClient = {
      user: { findUnique: vi.fn(async () => db.user), update: vi.fn(async ({ data }: any) => Object.assign(db.user, data)) },
      mfaSecret: { upsert: vi.fn(async ({ create }: any) => { db.mfa = create; return create; }) },
      $transaction: async (fn: any) => fn({ $executeRawUnsafe: vi.fn(), mfaSecret: prismaClient.mfaSecret, user: prismaClient.user }),
    };
    const svc = makeService(prismaClient);
    const setup = await svc.mfaSetup('u1', 't1');
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    // Wrong code must be rejected before anything is stored.
    await expect(svc.mfaVerifySetup(setup.secret, '000000')).rejects.toThrow();
    expect(db.mfa).toBeNull();
  });
});
