/**
 * Phase 11 — API keys (public API access).
 *
 * The plaintext key is generated once (`eserp_` + 32 hex chars) and returned
 * in the create response ONLY — afterwards only its SHA-256 hash + last-4
 * prefix are stored. Authentication happens in JwtAuthGuard (X-API-Key
 * header); scopes are permission strings enforced by PermissionsGuard
 * exactly like JWT permissions. Keys can be revoked (never un-revoked) and
 * expire via expiresAt. Rate limiting per key is in RateLimitGuard.
 */
import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ALL_PERMISSIONS, type ApiKeyDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

const KEY_SELECT = {
  id: true, tenantId: true, name: true, keyPrefix: true, scopes: true,
  expiresAt: true, lastUsedAt: true, status: true, createdAt: true, updatedAt: true, createdBy: true,
};

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: { page?: string; pageSize?: string; status?: string }) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).apiKey.count({ where }),
        (tx as any).apiKey.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: KEY_SELECT }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).apiKey.findUnique({ where: { id }, select: KEY_SELECT }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('API key not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: ApiKeyDto) {
    const unknown = dto.scopes.filter((s) => !ALL_PERMISSIONS.includes(s));
    if (unknown.length > 0) throw new BadRequestException(`Unknown API key scope(s): ${unknown.join(', ')}`);
    const plaintext = `eserp_${randomBytes(16).toString('hex')}`;
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const created: any = await this.prisma.withTenant(tenantId, async (tx) => {
      const row: any = await (tx as any).apiKey.create({
        data: {
          tenantId, name: dto.name, keyHash, keyPrefix: plaintext.slice(-4),
          scopes: dto.scopes as never, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          status: 'ACTIVE', createdBy: actorId,
        },
        select: KEY_SELECT,
      });
      await this.audit.log(
        { tenantId, actorId, action: 'create:ApiKey', entityType: 'ApiKey', entityId: row.id, after: { name: dto.name, scopes: dto.scopes } },
        tx as never,
      );
      await this.outbox.publish(tx as never, {
        tenantId, eventType: 'api-key.created', aggregateId: row.id,
        payload: { id: row.id, name: dto.name }, createdBy: actorId,
      });
      return row;
    });
    // The plaintext key is returned ONCE, here. It is never stored.
    return { ...toJson(created), apiKey: plaintext };
  }

  async revoke(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).apiKey.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('API key not found');
    if (before.status === 'REVOKED') throw new BadRequestException('API key is already revoked');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated: any = await (tx as any).apiKey.update({ where: { id }, data: { status: 'REVOKED' }, select: KEY_SELECT });
      await this.audit.log(
        { tenantId, actorId, action: 'revoke:ApiKey', entityType: 'ApiKey', entityId: id, before: { status: before.status }, after: { status: 'REVOKED' } },
        tx as never,
      );
      await this.outbox.publish(tx as never, {
        tenantId, eventType: 'api-key.revoked', aggregateId: id, payload: { id }, createdBy: actorId,
      });
      return toJson(updated);
    });
  }
}
