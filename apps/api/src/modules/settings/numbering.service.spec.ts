import { describe, expect, it } from 'vitest';
import { NumberingSeriesService } from './numbering.service';

function mockTx(series: Record<string, { pattern: string; nextNumber: number; prefix?: string; suffix?: string }>) {
  const state = { ...series };
  return {
    state,
    numberingSeries: {
      findUnique: async ({ where }: any) => {
        const s = state[where.code_tenantId.code];
        return s ? { id: `id-${where.code_tenantId.code}`, ...s } : null;
      },
      update: async ({ where, data }: any) => {
        const key = Object.keys(state).find((k) => `id-${k}` === where.id)!;
        state[key] = { ...state[key], ...data };
        return state[key];
      },
    },
  } as any;
}

describe('NumberingSeriesService', () => {
  it('formats INV-2026-00001 and increments', async () => {
    const svc = new NumberingSeriesService();
    const tx = mockTx({ INV: { pattern: 'INV-{YYYY}-{SEQ:5}', nextNumber: 1 } });
    const year = new Date().getFullYear();
    expect(await svc.nextNumber(tx, 't1', 'INV')).toBe(`INV-${year}-00001`);
    expect(await svc.nextNumber(tx, 't1', 'INV')).toBe(`INV-${year}-00002`);
    expect(tx.state.INV.nextNumber).toBe(3);
  });

  it('isolates counters per tenant', async () => {
    const svc = new NumberingSeriesService();
    // Two tenants have independent series rows (different tx state per tenant).
    const txA = mockTx({ INV: { pattern: 'INV-{YYYY}-{SEQ:5}', nextNumber: 10 } });
    const txB = mockTx({ INV: { pattern: 'INV-{YYYY}-{SEQ:5}', nextNumber: 1 } });
    const year = new Date().getFullYear();
    expect(await svc.nextNumber(txA, 'tenant-a', 'INV')).toBe(`INV-${year}-00010`);
    expect(await svc.nextNumber(txB, 'tenant-b', 'INV')).toBe(`INV-${year}-00001`);
  });

  it('supports {YY} and {MM} tokens', () => {
    const d = new Date(2026, 0, 15);
    expect(NumberingSeriesService.format('PO-{YY}-{MM}-{SEQ:3}', 7, d)).toBe('PO-26-01-007');
  });
});
