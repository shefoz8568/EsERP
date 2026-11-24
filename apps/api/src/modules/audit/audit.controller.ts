import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/tenant.decorator';

@ApiTags('audit')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AuditController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Permissions('audit:read')
  async list(
    @CurrentTenantId() tenantId: string,
    @Query('page') page = '1', @Query('pageSize') pageSize = '20',
    @Query('entityType') entityType?: string, @Query('action') action?: string,
    @Query('actorId') actorId?: string, @Query('from') from?: string, @Query('to') to?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where: Record<string, unknown> = { tenantId };
    if (entityType) where.entityType = entityType;
    if (action) where.action = action;
    if (actorId) where.actorId = actorId;
    if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
    const [total, data] = await this.prisma.withTenant(tenantId, async (tx) => Promise.all([
      tx.auditLog.count({ where }), tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * ps, take: ps }),
    ]));
    return { data, meta: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) } };
  }
}
