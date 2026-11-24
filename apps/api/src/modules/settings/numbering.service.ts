import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '../../common/prisma/prisma.service';

/**
 * Numbering series: patterns like INV-{YYYY}-{SEQ:5} expand to INV-2026-00001.
 * Supported tokens: {YYYY}, {YY}, {MM}, {SEQ:N} (zero-padded to N digits).
 * Counters are per-tenant (the series row is tenant-scoped) and incremented
 * inside the caller's transaction so a rolled-back document never burns a number.
 */
@Injectable()
export class NumberingSeriesService {
  static format(pattern: string, seq: number, date = new Date()): string {
    return pattern
      .replace('{YYYY}', String(date.getFullYear()))
      .replace('{YY}', String(date.getFullYear()).slice(2))
      .replace('{MM}', String(date.getMonth() + 1).padStart(2, '0'))
      .replace(/\{SEQ:(\d+)\}/g, (_m, width: string) => String(seq).padStart(Number(width), '0'))
      .replace('{SEQ}', String(seq));
  }

  async nextNumber(tx: PrismaTx, tenantId: string, seriesCode: string): Promise<string> {
    const series = await tx.numberingSeries.findUnique({ where: { code_tenantId: { code: seriesCode, tenantId } } });
    if (!series) throw new Error(`Numbering series ${seriesCode} not found`);
    const formatted = NumberingSeriesService.format(series.pattern, series.nextNumber);
    const withAffixes = `${series.prefix ?? ''}${formatted}${series.suffix ?? ''}`;
    await tx.numberingSeries.update({ where: { id: series.id }, data: { nextNumber: series.nextNumber + 1 } });
    return withAffixes;
  }

  async peek(tx: PrismaTx, tenantId: string, seriesCode: string): Promise<string> {
    const series = await tx.numberingSeries.findUnique({ where: { code_tenantId: { code: seriesCode, tenantId } } });
    if (!series) throw new Error(`Numbering series ${seriesCode} not found`);
    return `${series.prefix ?? ''}${NumberingSeriesService.format(series.pattern, series.nextNumber)}${series.suffix ?? ''}`;
  }
}
