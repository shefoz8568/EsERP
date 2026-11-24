import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * Audit interceptor: for POST/PUT/PATCH/DELETE on settings/users/roles it
 * records an audit entry (after the handler succeeds) with actor, action,
 * entity and the request body as the "after" snapshot. Detailed per-mutation
 * audit (with before/after inside the same transaction) is done by the
 * services themselves via AuditService.log(); this interceptor is the
 * safety net that guarantees no audited mutation goes unlogged.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const method = req.method as string;
    const path = req.url as string;
    const audited = /^\/(settings|users|roles|tenants|contacts|items|item-categories|pricelists)/.test(path) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!audited || !req.tenantId) return next.handle();
    return next.handle().pipe(
      tap({
        next: (result) => {
          const entityType = path.split('/')[1] ?? 'unknown';
          const entityId = (result as { id?: string })?.id ?? req.params?.id;
          void this.audit.log({
            tenantId: req.tenantId,
            actorId: req.user?.sub,
            action: `${method.toLowerCase()}:${entityType}`,
            entityType,
            entityId,
            after: { body: req.body, resultId: entityId },
            ipAddress: req.ip,
            userAgent: req.headers?.['user-agent'],
          }).catch(() => undefined);
        },
      }),
    );
  }
}
