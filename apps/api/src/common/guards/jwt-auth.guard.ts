import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALL_PERMISSIONS } from '@eserp/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Verifies the Bearer JWT and attaches req.user (sub, tenantId, email, roles).
 *
 * Phase 11 — API-key auth: when the `X-API-Key` header is present (and no
 * Bearer token), the key is resolved instead. The key is stored only as a
 * SHA-256 hash; the lookup runs in a bootstrap transaction because the
 * tenant is unknown until the key resolves. A valid key sets req.user with
 * `authType: 'api-key'`, `req.apiKeyId`, and `req.permissions` = the key's
 * scopes, so the PermissionsGuard enforces the same RBAC as for JWT users.
 * Revoked / expired / unknown keys are 401. `lastUsedAt` is updated
 * best-effort (never fails the request).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const apiKey = req.headers?.['x-api-key'] as string | undefined;
    if (apiKey) return this.authenticateApiKey(req, apiKey);
    const header = req.headers?.authorization as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing access token');
    try {
      req.user = await this.jwt.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private async authenticateApiKey(req: Record<string, unknown>, apiKey: string): Promise<boolean> {
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const key = await this.prisma.withBootstrap((tx) =>
      (tx as unknown as { apiKey: { findFirst: (args: unknown) => Promise<unknown> } }).apiKey.findFirst({ where: { keyHash } }),
    ) as { id: string; tenantId: string; status: string; expiresAt: Date | null; scopes: unknown } | null;
    if (!key) throw new UnauthorizedException('Invalid API key');
    if (key.status !== 'ACTIVE') throw new UnauthorizedException('API key is revoked');
    if (key.expiresAt && new Date(key.expiresAt) <= new Date()) throw new UnauthorizedException('API key is expired');
    const scopes = (Array.isArray(key.scopes) ? key.scopes : []).filter(
      (s): s is string => typeof s === 'string' && ALL_PERMISSIONS.includes(s),
    );
    req.user = { sub: `api-key:${key.id}`, tenantId: key.tenantId, email: '', roles: [], authType: 'api-key' };
    req.apiKeyId = key.id;
    req.permissions = scopes;
    // Best-effort last-used stamp; a failure here must not fail the request.
    void this.prisma
      .withTenant(key.tenantId, (tx) =>
        (tx as unknown as { apiKey: { update: (args: unknown) => Promise<unknown> } }).apiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: new Date() },
        }),
      )
      .catch(() => undefined);
    return true;
  }
}
