import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RBAC guard. Reads the required permissions from @Permissions(), loads the
 * caller's roles -> permissions from the DB (cached on the request for the
 * lifetime of that request), and denies when any required permission is missing.
 * A permission of "*" (OWNER) grants everything.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.sub || !user?.tenantId) throw new ForbiddenException('Authentication required');
    if (!req.permissions) {
      const userRoles = await this.prisma.withTenant(user.tenantId, (tx) => tx.userRole.findMany({
        where: { userId: user.sub, tenantId: user.tenantId },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      }));
      const raw = userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.name));
      // OWNER role name grants all; otherwise expand stored permissions.
      const isOwner = userRoles.some((ur) => ur.role.name === 'OWNER');
      req.permissions = isOwner ? ['*'] : [...new Set(raw)];
      req.roles = userRoles.map((ur) => ur.role.name);
    }
    const granted: string[] = req.permissions as string[];
    const ok = required.every((p) => granted.includes('*') || granted.includes(p));
    if (!ok) throw new ForbiddenException(`Missing permission: ${required.join(', ')}`);
    return true;
  }
}
