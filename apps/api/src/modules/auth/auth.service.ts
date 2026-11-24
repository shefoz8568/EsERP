import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes, createHash } from 'node:crypto';
import { AppError } from '@eserp/shared';
import { ALL_PERMISSIONS, ROLE_PERMISSION_MATRIX, expandPermissions, type RoleName } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import type { AppConfig } from '../../config/configuration';

export interface TokenPair { accessToken: string; refreshToken: string; }

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService<AppConfig>,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  private accessSecret(): string { return this.config.get<string>('jwtAccessSecret')!; }
  private refreshSecret(): string { return this.config.get<string>('jwtRefreshSecret')!; }

  /** Create the default roles + permission matrix for a new tenant (in-tx). */
  async seedDefaultRoles(tx: any, tenantId: string): Promise<Map<string, string>> {
    const roleIds = new Map<string, string>();
    for (const name of ALL_PERMISSIONS) {
      const [module, action] = name.split(':');
      await tx.permission.upsert({ where: { name }, update: {}, create: { name, module, action } });
    }
    const perms = await tx.permission.findMany();
    const byName = new Map(perms.map((p: any) => [p.name, p.id]));
    for (const roleName of Object.keys(ROLE_PERMISSION_MATRIX) as RoleName[]) {
      const role = await tx.role.create({ data: { tenantId, name: roleName, isSystem: true } });
      roleIds.set(roleName, role.id);
      for (const perm of expandPermissions(ROLE_PERMISSION_MATRIX[roleName])) {
        const pid = byName.get(perm);
        if (pid) await tx.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: pid } });
      }
    }
    return roleIds;
  }

  async register(dto: { tenantName: string; slug?: string; email: string; password: string; firstName?: string; lastName?: string; defaultCurrency?: string; defaultLocale?: string }): Promise<{ tenant: any; user: any; tokens: TokenPair }> {
    const slug = (dto.slug ?? dto.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 100) || `tenant-${Date.now().toString(36)}`;
    const existing = await this.prisma.client.tenant.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Tenant slug already taken');
    const passwordHash = await argon2.hash(dto.password);
    const result = await this.prisma.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: dto.tenantName, slug, defaultCurrency: dto.defaultCurrency ?? 'SAR', defaultLocale: dto.defaultLocale ?? 'ar' } });
      const tenantId = tenant.id;
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      const roleIds = await this.seedDefaultRoles(tx, tenantId);
      const user = await tx.user.create({ data: { tenantId, email: dto.email, passwordHash, firstName: dto.firstName, lastName: dto.lastName, locale: dto.defaultLocale ?? 'ar' } });
      await tx.userRole.create({ data: { tenantId, userId: user.id, roleId: roleIds.get('OWNER')! } });
      await tx.companyProfile.create({ data: { tenantId, legalName: dto.tenantName, tradeName: dto.tenantName, country: 'SA' } });
      await tx.onboardingState.create({ data: { tenantId, currentStep: 0, stepsCompleted: [] } });
      await tx.currency.create({ data: { tenantId, code: dto.defaultCurrency ?? 'SAR', name: dto.defaultCurrency ?? 'SAR', isDefault: true } });
      await tx.taxRate.create({ data: { tenantId, name: 'VAT 15%', nameAr: 'ضريبة القيمة المضافة 15%', rateBps: 1500, type: 'standard', isDefault: true } });
      await this.outbox.publish(tx, { tenantId, eventType: 'tenant.created', aggregateId: tenantId, payload: { slug } });
      return { tenant, user };
    });
    const tokens = await this.issueTokens(result.user.id, result.tenant.id, result.user.email, ['OWNER']);
    await this.audit.log({ tenantId: result.tenant.id, actorId: result.user.id, action: 'register', entityType: 'Tenant', entityId: result.tenant.id });
    return { tenant: result.tenant, user: { id: result.user.id, email: result.user.email, tenantId: result.tenant.id }, tokens };
  }

  async issueTokens(userId: string, tenantId: string, email: string, roles: string[]): Promise<TokenPair> {
    const payload = { sub: userId, tenantId, email, roles };
    const accessToken = await this.jwt.signAsync(payload, { secret: this.accessSecret(), expiresIn: this.config.get<number>('jwtAccessTtlSeconds') ?? 900 });
    const refreshRaw = randomBytes(48).toString('hex');
    const jti = createHash('sha256').update(refreshRaw).digest('hex');
    const refreshToken = await this.jwt.signAsync({ sub: userId, tenantId, jti }, { secret: this.refreshSecret(), expiresIn: this.config.get<number>('jwtRefreshTtlSeconds') ?? 2592000 });
    const expiresAt = new Date(Date.now() + (this.config.get<number>('jwtRefreshTtlSeconds') ?? 2592000) * 1000);
    // Store only the argon2 hash of the jti (never the raw token / jti itself),
    // inside the tenant context so RLS allows the insert.
    const tokenHash = await argon2.hash(jti);
    await this.prisma.withTenant(tenantId, (tx) => tx.refreshToken.create({ data: { tenantId, userId, tokenHash, expiresAt } }));
    return { accessToken, refreshToken };
  }

  async login(email: string, password: string, tenantSlug?: string): Promise<{ tokens?: TokenPair; mfaRequired?: boolean; mfaToken?: string; user?: any }> {
    // Pre-authentication: no tenant is known yet, so this lookup runs in the
    // narrow login-bootstrap transaction (see rls.sql); the password check
    // below is what actually authenticates.
    const user = await this.prisma.withBootstrap((tx) => tx.user.findFirst({ where: tenantSlug ? { email, tenant: { slug: tenantSlug } } : { email }, include: { tenant: true, userRoles: { include: { role: true } } } }));
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');
    const roles = user.userRoles.map((ur) => ur.role.name);
    if (user.mfaEnabled) {
      const mfaToken = await this.jwt.signAsync({ sub: user.id, tenantId: user.tenantId, purpose: 'mfa' }, { secret: this.accessSecret(), expiresIn: 300 });
      return { mfaRequired: true, mfaToken };
    }
    const tokens = await this.issueTokens(user.id, user.tenantId, user.email, roles);
    return { tokens, user: { id: user.id, email: user.email, tenantId: user.tenantId, roles } };
  }

  async verifyMfa(mfaToken: string, code: string): Promise<{ tokens: TokenPair; user: any }> {
    let payload: any;
    try { payload = await this.jwt.verifyAsync(mfaToken, { secret: this.accessSecret() }); } catch { throw new UnauthorizedException('Invalid or expired MFA token'); }
    if (payload.purpose !== 'mfa') throw new UnauthorizedException('Invalid MFA token');
    const secret = await this.prisma.withTenant(payload.tenantId, (tx) => tx.mfaSecret.findUnique({ where: { userId: payload.sub } }));
    const user = await this.prisma.withTenant(payload.tenantId, (tx) => tx.user.findUnique({ where: { id: payload.sub }, include: { userRoles: { include: { role: true } } } }));
    if (!secret || !user) throw new UnauthorizedException('MFA is not set up');
    if (!authenticator.check(code, secret.secret)) throw new UnauthorizedException('Invalid TOTP code');
    const tokens = await this.issueTokens(user.id, user.tenantId, user.email, user.userRoles.map((ur) => ur.role.name));
    return { tokens, user: { id: user.id, email: user.email, tenantId: user.tenantId } };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: any;
    try { payload = await this.jwt.verifyAsync(refreshToken, { secret: this.refreshSecret() }); } catch { throw new UnauthorizedException('Invalid or expired refresh token'); }
    const candidates = await this.prisma.withTenant(payload.tenantId, (tx) => tx.refreshToken.findMany({ where: { userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } } }));
    let matched: any = null;
    for (const c of candidates) {
      // The stored hash is of the raw random token embedded in the JWT jti.
      if (await argon2.verify(c.tokenHash, payload.jti)) { matched = c; break; }
    }
    if (!matched) throw new UnauthorizedException('Refresh token not found or revoked');
    // Rotation: revoke the old token, then issue a fresh pair.
    await this.prisma.withTenant(payload.tenantId, (tx) => tx.refreshToken.update({ where: { id: matched.id }, data: { revokedAt: new Date() } }));
    const user = await this.prisma.withTenant(payload.tenantId, (tx) => tx.user.findUnique({ where: { id: payload.sub }, include: { userRoles: { include: { role: true } } } }));
    if (!user) throw new UnauthorizedException('User not found');
    return this.issueTokens(user.id, user.tenantId, user.email, user.userRoles.map((ur) => ur.role.name));
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload: any = await this.jwt.verifyAsync(refreshToken, { secret: this.refreshSecret() });
      const candidates = await this.prisma.withTenant(payload.tenantId, (tx) => tx.refreshToken.findMany({ where: { userId: payload.sub, revokedAt: null } }));
      for (const c of candidates) {
        if (await argon2.verify(c.tokenHash, payload.jti)) {
          await this.prisma.withTenant(payload.tenantId, (tx) => tx.refreshToken.update({ where: { id: c.id }, data: { revokedAt: new Date() } }));
        }
      }
    } catch { /* logout is best-effort for an invalid token */ }
  }

  async me(userId: string, tenantId?: string): Promise<any> {
    const user = tenantId
      ? await this.prisma.withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id: userId }, include: { tenant: true, userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } } }))
      : await this.prisma.withBootstrap((tx) => tx.user.findUnique({ where: { id: userId }, include: { tenant: true, userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } } }));
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
      tenantId: user.tenantId, tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
      roles: user.userRoles.map((ur) => ur.role.name),
      permissions: [...new Set(user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.name)))],
      mfaEnabled: user.mfaEnabled, locale: user.locale,
    };
  }

  async mfaSetup(userId: string, tenantId: string): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const user = await this.prisma.withTenant(tenantId, (tx) => tx.user.findUnique({ where: { id: userId } }));
    if (!user) throw new NotFoundException('User not found');
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'EsERP', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    // Store the secret only after verify — keep the pending secret in a
    // short-lived signed token instead of the DB.
    const pending = await this.jwt.signAsync({ sub: userId, tenantId, secret, purpose: 'mfa-setup' }, { secret: this.accessSecret(), expiresIn: 600 });
    return { secret: pending, otpauthUrl, qrDataUrl };
  }

  async mfaVerifySetup(pendingToken: string, code: string): Promise<void> {
    let payload: any;
    try { payload = await this.jwt.verifyAsync(pendingToken, { secret: this.accessSecret() }); } catch { throw new UnauthorizedException('Invalid or expired MFA setup token'); }
    if (payload.purpose !== 'mfa-setup' || !authenticator.check(code, payload.secret)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${payload.tenantId}'`);
      await tx.mfaSecret.upsert({ where: { userId: payload.sub }, update: { secret: payload.secret }, create: { tenantId: payload.tenantId, userId: payload.sub, secret: payload.secret } });
      await tx.user.update({ where: { id: payload.sub }, data: { mfaEnabled: true } });
    });
  }

  async mfaDisable(userId: string, tenantId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await tx.mfaSecret.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false } });
    });
  }

  /** OAuth login/registration for a verified provider profile (shared by Google/Microsoft). */
  async oauthLogin(profile: { provider: string; subject: string; email: string; firstName?: string; lastName?: string }): Promise<TokenPair> {
    let user = await this.prisma.withBootstrap((tx) => tx.user.findFirst({ where: { oauthProvider: profile.provider, oauthSubject: profile.subject } }));
    if (!user) {
      // Link to an existing account with the same email, or reject: OAuth
      // never creates a tenant by itself (register first, then link).
      const existing = await this.prisma.withBootstrap((tx) => tx.user.findFirst({ where: { email: profile.email } }));
      if (!existing) throw new AppError('OAUTH_NO_ACCOUNT', 'No EsERP account exists for this email — register first', 404);
      user = await this.prisma.withTenant(existing.tenantId, (tx) => tx.user.update({ where: { id: existing.id }, data: { oauthProvider: profile.provider, oauthSubject: profile.subject } }));
    }
    if (!user) throw new AppError('OAUTH_NO_ACCOUNT', 'OAuth account linking failed', 500);
    const roles = await this.prisma.withTenant(user.tenantId, (tx) => tx.userRole.findMany({ where: { userId: user.id }, include: { role: true } }));
    return this.issueTokens(user.id, user.tenantId, user.email, roles.map((r) => r.role.name));
  }
}
