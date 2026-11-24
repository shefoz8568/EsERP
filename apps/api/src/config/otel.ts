import { Logger } from '@nestjs/common';

/**
 * OpenTelemetry stub. When OTEL_ENABLED=false (the default) this is a pure
 * no-op tracer provider — no exporter, no network calls. When enabled, the
 * real SDK wiring lives here (Phase 0 ships the stub only; the provider
 * interface is stable so a real exporter can be dropped in later).
 */
export interface Tracer {
  startSpan(name: string): { end(): void; setAttribute(key: string, value: string): void };
}

const noopSpan = { end: () => undefined, setAttribute: () => undefined };
const noopTracer: Tracer = { startSpan: () => noopSpan };

export function initOtel(enabled: boolean, endpoint?: string): Tracer {
  const logger = new Logger('OTel');
  if (!enabled) {
    logger.log('OpenTelemetry disabled (OTEL_ENABLED=false) — using no-op tracer');
    return noopTracer;
  }
  // Real exporter wiring is intentionally deferred: Phase 0 only needs the
  // stub. Log loudly so an operator knows traces are not actually exported.
  logger.warn(`OTEL_ENABLED=true but no exporter is wired in Phase 0 (endpoint=${endpoint ?? 'unset'}) — traces are no-op`);
  return noopTracer;
}

export const tracer: Tracer = noopTracer;
