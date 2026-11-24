import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TenantsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService) {}

  async get(tenantId: string) {
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async update(tenantId: string, actorId: string, dto: { name?: string; defaultCurrency?: string; defaultLocale?: string; fiscalYearStartMonth?: number; calendarType?: string }) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId } });
      const tenant = await tx.tenant.update({ where: { id: tenantId }, data: dto });
      await this.audit.log({ tenantId, actorId, action: 'update:Tenant', entityType: 'Tenant', entityId: tenantId, before, after: tenant }, tx as any);
      return tenant;
    });
  }
}
