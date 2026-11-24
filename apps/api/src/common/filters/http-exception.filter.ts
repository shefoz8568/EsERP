import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { AppError } from '@eserp/shared';

/** Structural ZodError check — see the comment in GlobalExceptionFilter.catch. */
function isZodError(exception: unknown): exception is { issues: { path: (string | number)[]; message: string }[] } {
  return (
    exception instanceof Error &&
    exception.name === 'ZodError' &&
    Array.isArray((exception as { issues?: unknown }).issues)
  );
}

/** Global filter: every error leaves the API as { error: { code, message } }. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    if (exception instanceof AppError) {
      status = exception.status; code = exception.code; message = exception.message;
    } else if (isZodError(exception)) {
      // Controllers validate bodies with shared Zod DTOs (.parse) — a failed
      // parse is a client error (400), never a 500. Detected structurally
      // (name + issues) rather than instanceof: @eserp/shared bundles its
      // own zod copy, so instanceof fails across the package boundary.
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = exception.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as { message?: string | string[]; error?: string };
      code = body?.error ? String(body.error).toUpperCase().replace(/ /g, '_') : `HTTP_${status}`;
      message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message ?? exception.message;
    }
    if (status >= 500) this.logger.error(`${req.method} ${req.url} -> ${status} ${code}`, exception instanceof Error ? exception.stack : undefined);
    res.status(status).json({ error: { code, message } });
  }
}
