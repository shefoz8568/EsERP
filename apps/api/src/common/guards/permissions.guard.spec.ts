import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function guardWith(required: string[] | undefined, roles: { name: string; permissions: string[] }[]) {
  const reflector = { getAllAndOverride: vi.fn(() => required) } as unknown as Reflector;
  const userRoles = roles.map((r) => ({ role: { name: r.name, rolePermissions: r.permissions.map((p) => ({ permission: { name: p } })) } }));
  // The guard loads roles through PrismaService.withTenant(); emulate it by
  // invoking the callback with a fake tx exposing userRole.findMany.
  const prisma = { withTenant: vi.fn(async (_tenantId: string, fn: (tx: any) => Promise<unknown>) => fn({ userRole: { findMany: vi.fn(async () => userRoles) } })) } as any;
  const guard = new PermissionsGuard(reflector, prisma);
  const ctx: any = { switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u1', tenantId: 't1' } }) }), getHandler: () => ({}), getClass: () => ({}) };
  return { guard, ctx };
}

describe('PermissionsGuard', () => {
  it('allows when the user has the required permission', async () => {
    const { guard, ctx } = guardWith(['settings:manage'], [{ name: 'ADMIN', permissions: ['settings:manage'] }]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies without the permission', async () => {
    const { guard, ctx } = guardWith(['settings:manage'], [{ name: 'VIEWER', permissions: ['settings:read'] }]);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Missing permission/);
  });

  it('allows OWNER (all permissions)', async () => {
    const { guard, ctx } = guardWith(['tenants:delete'], [{ name: 'OWNER', permissions: [] }]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows when no permission is required', async () => {
    const { guard, ctx } = guardWith(undefined, []);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
