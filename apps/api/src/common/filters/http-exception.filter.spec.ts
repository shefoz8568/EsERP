import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GlobalExceptionFilter } from './http-exception.filter';

function mockHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status };
  const req = { method: 'POST', url: '/api/v1/contacts', ip: '127.0.0.1', headers: {} };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as any;
  return { host, json, status };
}

describe('GlobalExceptionFilter', () => {
  it('maps a Zod validation error to 400 VALIDATION_ERROR, not 500', () => {
    const filter = new GlobalExceptionFilter();
    const { host, json, status } = mockHost();
    const err = new z.ZodError([{ code: 'invalid_string', validation: 'regex', message: 'Saudi VAT number must be exactly 15 digits', path: ['taxNumber'] } as any]);
    filter.catch(err, host);
    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('taxNumber');
  });
});
