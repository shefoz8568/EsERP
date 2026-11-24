import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(tenantId: string, userId: string, page = 1, pageSize = 20, unreadOnly = false) {
    const where: Record<string, unknown> = { tenantId, userId };
    if (unreadOnly) where.readAt = null;
    const [total, data] = await this.prisma.withTenant(tenantId, async (tx) => Promise.all([
      tx.notification.count({ where }), tx.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]));
    return { data, meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } };
  }

  async markRead(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const n = await tx.notification.findUnique({ where: { id } });
      if (!n || n.tenantId !== tenantId) return null;
      return tx.notification.update({ where: { id }, data: { readAt: new Date() } });
    });
  }

  async create(tenantId: string, userId: string | undefined, title: string, body?: string, type = 'info') {
    return this.prisma.withTenant(tenantId, (tx) => tx.notification.create({ data: { tenantId, userId, title, body, type } }));
  }
}
