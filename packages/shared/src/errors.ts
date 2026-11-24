/** Application error with a stable machine-readable code and HTTP status. */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    // Prefix the machine-readable code so `toThrow(/CODE/)` and log grep work
    // on the message alone; the API error filter still sends code separately.
    super(`[${code}] ${message}`);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown): AppError {
    return new AppError(code, message, 400, details);
  }

  static unauthorized(code = 'UNAUTHORIZED', message = 'Unauthorized'): AppError {
    return new AppError(code, message, 401);
  }

  static forbidden(code = 'FORBIDDEN', message = 'Forbidden'): AppError {
    return new AppError(code, message, 403);
  }

  static notFound(code = 'NOT_FOUND', message = 'Not found'): AppError {
    return new AppError(code, message, 404);
  }

  static conflict(code: string, message: string): AppError {
    return new AppError(code, message, 409);
  }

  static unprocessable(code: string, message: string, details?: unknown): AppError {
    return new AppError(code, message, 422, details);
  }
}
