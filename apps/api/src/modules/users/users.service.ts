import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService, @Inject(QueueService) private readonly queue: QueueService) {}

  async list(tenantId: string, page = 1, pageSize = 20) {
    const [total, data] = await this.prisma.withTenant(tenantId, async (tx) => Promise.all([
      tx.user.count({ where: { tenantId } }),
      tx.user.findMany({ where: { tenantId }, include: { userRoles: { include: { role: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]));
    return { data: data.map((u) => ({ ...u, passwordHash: undefined, roles: u.userRoles.map((r) => r.role.name) })), meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } };
  }

  async invite(tenantId: string, actorId: string, dto: { email: string; roleNames: string[]; firstName?: string; lastName?: string }) {
    const existing = await this.prisma.withTenant(tenantId, (tx) => tx.user.findUnique({ where: { email_tenantId: { email: dto.email, tenantId } } }));
    if (existing) throw new ConflictException('User already exists in this tenant');
    const roles = await this.prisma.withTenant(tenantId, (tx) => tx.role.findMany({ where: { tenantId, name: { in: dto.roleNames } } }));
    if (roles.length !== dto.roleNames.length) throw new NotFoundException('One or more roles not found');
    const token = randomUUID();
    const user = await this.prisma.withTenant(tenantId, async (tx) => {
      const created = await tx.user.create({ data: { tenantId, email: dto.email, firstName: dto.firstName, lastName: dto.lastName, isActive: false } });
      for (const role of roles) await tx.userRole.create({ data: { tenantId, userId: created.id, roleId: role.id } });
      await tx.invitation.create({ data: { tenantId, email: dto.email, roleNames: dto.roleNames, tokenHash: await argon2.hash(token), invitedById: actorId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) } });
      await this.audit.log({ tenantId, actorId, action: 'invite:User', entityType: 'User', entityId: created.id, after: { email: dto.email, roleNames: dto.roleNames } }, tx as any);
      return created;
    });
    await this.queue.queueEmail({ to: dto.email, subject: 'You are invited to EsERP', text: `You have been invited to join EsERP. Invitation token: ${token}` });
    return { id: user.id, email: user.email };
  }

  async update(tenantId: string, actorId: string, id: string, dto: { isActive?: boolean; locale?: string; firstName?: string; lastName?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before || before.tenantId !== tenantId) throw new NotFoundException('User not found');
      const updated = await tx.user.update({ where: { id }, data: dto });
      await this.audit.log({ tenantId, actorId, action: 'update:User', entityType: 'User', entityId: id, before: { isActive: before.isActive }, after: dto }, tx as any);
      return { ...updated, passwordHash: undefined };
    });
  }
}
