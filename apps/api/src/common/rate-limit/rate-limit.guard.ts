import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { FixedWindowLimiter } from './rate-limiter';

/**
 * Phase 11 — global rate-limit guard (registered after the auth guards in
 * AppModule, so it can key on the authenticated tenant / API key).
 *
 * Bucket key: `api-key:<keyId>` for API-key requests, `tenant:<tenantId>:<ip>`
 * for JWT requests, `ip:<ip>` for public routes. The limit is generous by
 * default (600/min/tenant) so normal ERP use never trips it; auth abuse is
 * bounded by the same per-IP bucket on public routes.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter: FixedWindowLimiter;
  private readonly apiKeyLimiter: FixedWindowLimiter;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig>) {
    const cfg = config.get<AppConfig>('rateLimit') as AppConfig['rateLimit'] | undefined;
    const max = cfg?.max ?? 600;
    const windowSeconds = cfg?.windowSeconds ?? 60;
    const apiKeyMax = cfg?.apiKeyMax ?? 300;
    const apiKeyWindowSeconds = cfg?.apiKeyWindowSeconds ?? 60;
    this.limiter = new FixedWindowLimiter(max, windowSeconds * 1000);
    this.apiKeyLimiter = new FixedWindowLimiter(apiKeyMax, apiKeyWindowSeconds * 1000);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const ip = (req.ip as string | undefined) ?? req.headers?.['x-forwarded-for'] ?? 'unknown';
    if (req.apiKeyId) {
      const r = this.apiKeyLimiter.check(`api-key:${req.apiKeyId as string}`);
      if (!r.allowed) {
        res?.setHeader?.('Retry-After', String(r.retryAfterSeconds));
        throw this.tooMany(r.retryAfterSeconds);
      }
      return true;
    }
    const tenant = (req.user?.tenantId as string | undefined) ?? (req.tenantId as string | undefined);
    const key = tenant ? `tenant:${tenant}:${ip}` : `ip:${ip}`;
    const r = this.limiter.check(key);
    if (!r.allowed) {
      res?.setHeader?.('Retry-After', String(r.retryAfterSeconds));
      throw this.tooMany(r.retryAfterSeconds);
    }
    return true;
  }

  private tooMany(retryAfterSeconds: number): HttpException {
    // Shape matches what GlobalExceptionFilter expects from HttpException:
    // { message, error } with error a plain string code.
    return new HttpException(
      { message: `Too many requests — retry after ${retryAfterSeconds}s`, error: 'RATE_LIMITED' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
