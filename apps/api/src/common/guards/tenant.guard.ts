import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_HEADER_TENANT_KEY } from '../decorators/permissions.decorator';

/**
 * Tenancy guard (global). The tenant comes from the JWT tenantId claim.
 * X-Tenant-Id is honoured ONLY on routes explicitly marked with
 * @AllowHeaderTenant() (register / onboarding bootstrap) — everywhere else
 * a header tenant that disagrees with the JWT is rejected.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const allowHeader = this.reflector.getAllAndOverride<boolean>(ALLOW_HEADER_TENANT_KEY, [ctx.getHandler(), ctx.getClass()]);
    const headerTenant = req.headers?.['x-tenant-id'] as string | undefined;
    if (req.user?.tenantId) {
      if (headerTenant && headerTenant !== req.user.tenantId) {
        throw new ForbiddenException('X-Tenant-Id does not match the authenticated tenant');
      }
      req.tenantId = req.user.tenantId;
      return true;
    }
    if (isPublic && allowHeader && headerTenant) {
      req.tenantId = headerTenant;
      return true;
    }
    if (isPublic) return true; // e.g. /health, /auth/register (creates its own tenant)
    throw new ForbiddenException('Tenant context is required');
  }
}
