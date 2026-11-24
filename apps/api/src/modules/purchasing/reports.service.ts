import { Inject, Injectable } from '@nestjs/common';
import { computeAging, daysPastDue } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toJson } from '../master-data/serialize';

/**
 * AP aging report (Phase 4): per supplier, unpaid balances of POSTED /
 * PARTIALLY_PAID supplier invoices, bucketed by days past due with the
 * same buckets as AR aging: CURRENT | 1–30 | 31–60 | 61–90 | 90+.
 */
@Injectable()
export class PurchasingReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async apAging(tenantId: string, asOf?: string) {
    const refDate = asOf ? new Date(asOf) : new Date();
    const rows: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).supplierInvoice.findMany({
        where: { tenantId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
        select: {
          id: true, number: true, supplierId: true, invoiceDate: true, dueDate: true,
          totalMinor: true, paidMinor: true, status: true,
          supplier: { select: { id: true, displayName: true, legalName: true } },
        },
        orderBy: { dueDate: 'asc' },
      }),
    );
    const bySupplier = new Map<string, { supplier: any; rows: any[] }>();
    for (const inv of rows) {
      const balance = BigInt(inv.totalMinor) - BigInt(inv.paidMinor);
      if (balance <= 0n) continue;
      const entry = bySupplier.get(inv.supplierId) ?? { supplier: inv.supplier, rows: [] };
      entry.rows.push({
        invoiceId: inv.id, number: inv.number, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate,
        totalMinor: Number(inv.totalMinor), paidMinor: Number(inv.paidMinor), balanceMinor: Number(balance),
        daysPastDue: daysPastDue(inv.dueDate, refDate), status: inv.status,
      });
      bySupplier.set(inv.supplierId, entry);
    }
    const suppliers = [...bySupplier.values()].map(({ supplier, rows: invRows }) => {
      const aging = computeAging(invRows.map((r: any) => ({ balanceMinor: BigInt(r.balanceMinor), daysPastDue: r.daysPastDue })));
      return {
        supplierId: supplier.id, supplierName: supplier.displayName, supplierLegalName: supplier.legalName,
        currentMinor: Number(aging.currentMinor), d1_30Minor: Number(aging.d1_30Minor),
        d31_60Minor: Number(aging.d31_60Minor), d61_90Minor: Number(aging.d61_90Minor),
        d90PlusMinor: Number(aging.d90PlusMinor), totalMinor: Number(aging.totalMinor),
        invoices: invRows,
      };
    });
    const totals = suppliers.reduce(
      (s, c) => ({
        currentMinor: s.currentMinor + c.currentMinor, d1_30Minor: s.d1_30Minor + c.d1_30Minor,
        d31_60Minor: s.d31_60Minor + c.d31_60Minor, d61_90Minor: s.d61_90Minor + c.d61_90Minor,
        d90PlusMinor: s.d90PlusMinor + c.d90PlusMinor, totalMinor: s.totalMinor + c.totalMinor,
      }),
      { currentMinor: 0, d1_30Minor: 0, d31_60Minor: 0, d61_90Minor: 0, d90PlusMinor: 0, totalMinor: 0 },
    );
    return toJson({ asOf: refDate.toISOString(), suppliers, totals });
  }
}
