import { Inject, Injectable } from '@nestjs/common';
import { PrismaService, type PrismaTx } from '../../common/prisma/prisma.service';

export interface AuditEntry {
  tenantId: string; actorId?: string; action: string; entityType: string;
  entityId?: string; before?: unknown; after?: unknown; ipAddress?: string; userAgent?: string;
}

/**
 * Audit log. Append-only: there are deliberately NO update/delete endpoints
 * for AuditLog anywhere in the API. log() accepts an optional tx client so
 * the entry is written in the SAME transaction as the mutation it records.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    if (!tx) {
      // No ambient transaction: run in a tenant-scoped one so RLS allows the insert.
      await this.prisma.withTenant(entry.tenantId, (t) => this.log(entry, t as PrismaTx));
      return;
    }
    const client = tx as PrismaTx;
    await client.auditLog.create({
      data: {
        tenantId: entry.tenantId, actorId: entry.actorId, action: entry.action,
        entityType: entry.entityType, entityId: entry.entityId,
        before: entry.before === undefined ? undefined : (entry.before as object),
        after: entry.after === undefined ? undefined : (entry.after as object),
        ipAddress: entry.ipAddress, userAgent: entry.userAgent, createdBy: entry.actorId,
      },
    });
  }
}
