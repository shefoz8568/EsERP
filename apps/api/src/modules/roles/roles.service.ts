import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RolesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService) {}

  async list(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) =>
      tx.role.findMany({ where: { tenantId }, include: { rolePermissions: { include: { permission: true } } }, orderBy: { name: 'asc' } }));
  }

  async create(tenantId: string, actorId: string, dto: { name: string; description?: string; permissions?: string[] }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const role = await tx.role.create({ data: { tenantId, name: dto.name, description: dto.description } });
      if (dto.permissions?.length) {
        const perms = await tx.permission.findMany({ where: { name: { in: dto.permissions } } });
        for (const p of perms) await tx.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: p.id } });
      }
      await this.audit.log({ tenantId, actorId, action: 'create:Role', entityType: 'Role', entityId: role.id, after: dto }, tx as any);
      return role;
    });
  }

  /** Replace a role's permission set (tenant admins only). */
  async setPermissions(tenantId: string, actorId: string, roleId: string, permissions: string[]) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId } });
      if (!role || role.tenantId !== tenantId) throw new NotFoundException('Role not found');
      const before = await tx.rolePermission.findMany({ where: { roleId }, include: { permission: true } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      const perms = await tx.permission.findMany({ where: { name: { in: permissions } } });
      for (const p of perms) await tx.rolePermission.create({ data: { tenantId, roleId, permissionId: p.id } });
      await this.audit.log({ tenantId, actorId, action: 'update:RolePermissions', entityType: 'Role', entityId: roleId, before: before.map((b) => b.permission.name), after: permissions }, tx as any);
      return { roleId, permissions: perms.map((p) => p.name) };
    });
  }

  async listPermissions() {
    return this.prisma.client.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  }
}
