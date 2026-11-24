import { describe, expect, it } from 'vitest';

/**
 * RLS integration test — proves tenant A can never read tenant B's rows.
 * Skipped (with a clear message) when DATABASE_URL is unset or the DB is
 * unreachable, so `pnpm test` stays green on machines without Postgres.
 * Requires the 0002_rls migration to have been applied.
 */
describe('Row-Level Security (RLS)', () => {
  it('isolates tenants at the database level', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log('SKIPPED: RLS test — DATABASE_URL is not set (needs Postgres + migrations).');
      return;
    }
    let prisma: import('@prisma/client').PrismaClient;
    try {
      const mod = await import('@prisma/client');
      prisma = new mod.PrismaClient();
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.log(`SKIPPED: RLS test — database unreachable (${(err as Error).message}).`);
      return;
    }

    // RLS policies are bypassed entirely for superusers (and FORCE ROW LEVEL
    // SECURITY does not change that), so a superuser connection can never
    // prove isolation. Fail loudly instead of passing vacuously.
    const [{ usesuper }] = await prisma.$queryRawUnsafe<{ usesuper: boolean }[]>(
      `SELECT usesuper FROM pg_user WHERE usename = current_user`,
    );
    if (usesuper) {
      await prisma.$disconnect();
      throw new Error(
        'RLS test must run as a NON-superuser app role (e.g. eserp_app): superusers bypass RLS, so isolation cannot be proven on this connection. See README "Database roles".',
      );
    }

    const suffix = Date.now().toString(36);
    const tenantA = await prisma.tenant.create({ data: { name: `RLS A ${suffix}`, slug: `rls-a-${suffix}` } });
    const tenantB = await prisma.tenant.create({ data: { name: `RLS B ${suffix}`, slug: `rls-b-${suffix}` } });
    try {
      // Seed rows for both tenants while each tenant context is active.
      // Phase 1: a contact, a category, an item and a price list per tenant.
      const phase1: Record<string, { contactId: string; itemId: string; listId: string }> = {};
      const phase2: Record<string, { periodId: string; entryId: string; costCenterId: string }> = {};
      const phase34: Record<string, { leadId: string; oppId: string; quoteId: string; orderId: string; salesInvoiceId: string; poId: string; supInvoiceId: string }> = {};
      const phase56: Record<string, { levelId: string; layerId: string; movementId: string; grnId: string; dnId: string; adjId: string; trfId: string; cntId: string; terminalId: string; shiftId: string; saleId: string }> = {};
      const phase78: Record<string, { workCenterId: string; bomId: string; bomLineId: string; workOrderId: string; workOrderLineId: string; operationId: string; issueId: string; receiptId: string; scrapId: string; departmentId: string; employeeId: string; leaveTypeId: string; leaveRequestId: string; attendanceId: string; payrollRunId: string; payrollLineId: string }> = {};
      const phase910: Record<string, { projectId: string; taskId: string; timesheetId: string; expenseId: string; milestoneId: string; snapshotId: string }> = {};
      for (const t of [tenantA, tenantB]) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${t.id}'`);
          await tx.user.create({ data: { tenantId: t.id, email: `u@${t.slug}.test` } });
          const contact = await tx.contact.create({ data: { tenantId: t.id, type: 'CUSTOMER', legalName: `Customer ${t.slug}`, displayName: `Customer ${t.slug}` } });
          const uom = await tx.unitOfMeasure.create({ data: { tenantId: t.id, code: 'piece', name: 'Piece' } });
          const category = await tx.itemCategory.create({ data: { tenantId: t.id, code: 'CAT', name: 'Category' } });
          const item = await tx.item.create({ data: { tenantId: t.id, sku: `SKU-${suffix}`, name: `Item ${t.slug}`, categoryId: category.id, defaultUomId: uom.id, salesPriceMinor: 100n } });
          const list = await tx.priceList.create({ data: { tenantId: t.id, name: 'Standard', currency: 'SAR' } });
          await tx.priceListItem.create({ data: { tenantId: t.id, priceListId: list.id, itemId: item.id, priceMinor: 100n } });
          phase1[t.id] = { contactId: contact.id, itemId: item.id, listId: list.id };
          // Phase 2: fiscal period, cost centre, leaf accounts, opening
          // balance and a posted journal entry per tenant.
          const period = await tx.fiscalPeriod.create({ data: { tenantId: t.id, fiscalYear: 2026, periodNumber: 11, startDate: new Date('2026-11-01T00:00:00.000Z'), endDate: new Date('2026-11-30T23:59:59.999Z'), status: 'OPEN' } });
          const costCenter = await tx.costCenter.create({ data: { tenantId: t.id, code: 'HQ', name: 'Head Office' } });
          const cash = await tx.chartOfAccounts.create({ data: { tenantId: t.id, code: '1010', nameAr: 'الصندوق', nameEn: 'Cash on Hand', type: 'ASSET' } });
          const sales = await tx.chartOfAccounts.create({ data: { tenantId: t.id, code: '4010', nameAr: 'المبيعات', nameEn: 'Sales', type: 'REVENUE' } });
          await tx.openingBalance.create({ data: { tenantId: t.id, accountId: cash.id, fiscalYear: 2026, debitMinor: 100000n, creditMinor: 0n, currency: 'SAR' } });
          const entry = await tx.journalEntry.create({
            data: {
              tenantId: t.id, number: `JE-2026-${t === tenantA ? 'A' : 'B'}`, entryDate: new Date('2026-11-05T00:00:00.000Z'),
              fiscalPeriodId: period.id, status: 'POSTED', description: `Sale ${t.slug}`, sourceModule: 'MANUAL',
              currency: 'SAR', totalDebitMinor: 115000n, totalCreditMinor: 115000n, postedAt: new Date(),
              lines: { create: [
                { tenantId: t.id, accountId: cash.id, debitMinor: 115000n, creditMinor: 0n, currency: 'SAR', costCenterId: costCenter.id, lineOrder: 0 },
                { tenantId: t.id, accountId: sales.id, debitMinor: 0n, creditMinor: 115000n, currency: 'SAR', lineOrder: 1 },
              ] },
            },
          });
          phase2[t.id] = { periodId: period.id, entryId: entry.id, costCenterId: costCenter.id };
          // Phase 3/4: lead, opportunity, quote, order, sales invoice,
          // purchase order and supplier invoice per tenant.
          const lead = await tx.lead.create({ data: { tenantId: t.id, name: `Lead ${t.slug}`, source: 'WEBSITE', expectedValueMinor: 100000n } });
          const opp = await tx.opportunity.create({ data: { tenantId: t.id, customerId: contact.id, leadId: lead.id, title: `Deal ${t.slug}`, stage: 'PROSPECTING', probability: 50, expectedValueMinor: 100000n } });
          const quote = await tx.salesQuote.create({
            data: {
              tenantId: t.id, number: `QUO-2026-${t === tenantA ? 'A' : 'B'}`, customerId: contact.id,
              validFrom: new Date('2026-11-01T00:00:00.000Z'), validTo: new Date('2026-12-31T00:00:00.000Z'),
              status: 'DRAFT', currency: 'SAR', subtotalMinor: 10000n, taxMinor: 1500n, totalMinor: 11500n,
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantity: 10n, unitPriceMinor: 1000n, taxRateBps: 1500, lineSubtotalMinor: 10000n, lineTaxMinor: 1500n, lineTotalMinor: 11500n, lineOrder: 0 }] },
            },
          });
          const order = await tx.salesOrder.create({
            data: {
              tenantId: t.id, number: `SO-2026-${t === tenantA ? 'A' : 'B'}`, customerId: contact.id, quoteId: quote.id,
              status: 'DRAFT', currency: 'SAR', subtotalMinor: 10000n, taxMinor: 1500n, totalMinor: 11500n,
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantityOrdered: 10n, quantityFulfilled: 0n, unitPriceMinor: 1000n, taxRateBps: 1500, lineSubtotalMinor: 10000n, lineTaxMinor: 1500n, lineTotalMinor: 11500n, lineOrder: 0 }] },
            },
          });
          const salesInvoice = await tx.salesInvoice.create({
            data: {
              tenantId: t.id, number: `INV-2026-${t === tenantA ? 'A' : 'B'}`, customerId: contact.id, orderId: order.id,
              status: 'DRAFT', currency: 'SAR', invoiceDate: new Date('2026-11-10T00:00:00.000Z'), dueDate: new Date('2026-12-10T00:00:00.000Z'),
              subtotalMinor: 10000n, taxMinor: 1500n, totalMinor: 11500n, paidMinor: 0n,
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantity: 10n, unitPriceMinor: 1000n, taxRateBps: 1500, lineSubtotalMinor: 10000n, lineTaxMinor: 1500n, lineTotalMinor: 11500n, lineOrder: 0 }] },
            },
          });
          const po = await tx.purchaseOrder.create({
            data: {
              tenantId: t.id, number: `PO-2026-${t === tenantA ? 'A' : 'B'}`, supplierId: contact.id,
              status: 'DRAFT', currency: 'SAR', subtotalMinor: 10000n, taxMinor: 1500n, totalMinor: 11500n,
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantityOrdered: 10n, quantityReceived: 0n, unitCostMinor: 1000n, taxRateBps: 1500, lineSubtotalMinor: 10000n, lineTaxMinor: 1500n, lineTotalMinor: 11500n, lineOrder: 0 }] },
            },
          });
          const supInvoice = await tx.supplierInvoice.create({
            data: {
              tenantId: t.id, number: `SIN-2026-${t === tenantA ? 'A' : 'B'}`, supplierId: contact.id, purchaseOrderId: po.id,
              status: 'DRAFT', currency: 'SAR', invoiceDate: new Date('2026-11-10T00:00:00.000Z'), dueDate: new Date('2026-12-10T00:00:00.000Z'),
              subtotalMinor: 10000n, taxMinor: 1500n, totalMinor: 11500n, paidMinor: 0n,
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantity: 10n, unitCostMinor: 1000n, taxRateBps: 1500, lineSubtotalMinor: 10000n, lineTaxMinor: 1500n, lineTotalMinor: 11500n, lineOrder: 0 }] },
            },
          });
          phase34[t.id] = { leadId: lead.id, oppId: opp.id, quoteId: quote.id, orderId: order.id, salesInvoiceId: salesInvoice.id, poId: po.id, supInvoiceId: supInvoice.id };
          // Phase 5/6: warehouse + branch, stock level/layer/movement, one
          // document of each inventory kind, and a POS terminal/shift/sale.
          const warehouse = await tx.warehouse.create({ data: { tenantId: t.id, code: 'WH-1', name: 'Warehouse 1', isDefault: true } });
          const branch = await tx.branch.create({ data: { tenantId: t.id, code: 'BR-1', name: 'Branch 1', isDefault: true } });
          const level = await tx.stockLevel.create({ data: { tenantId: t.id, warehouseId: warehouse.id, itemId: item.id, qtyOnHand: 10n, qtyReserved: 2n, averageCostMinor: 1000n, lastCostMinor: 1000n } });
          const layer = await tx.stockCostLayer.create({ data: { tenantId: t.id, warehouseId: warehouse.id, itemId: item.id, sourceType: 'GOODS_RECEIPT', quantityRemaining: 10n, unitCostMinor: 1000n } });
          const movement = await tx.stockMovement.create({ data: { tenantId: t.id, type: 'IN', itemId: item.id, warehouseId: warehouse.id, quantity: 10n, unitCostMinor: 1000n, totalCostMinor: 10000n, sourceType: 'GOODS_RECEIPT' } });
          const poLine = await tx.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
          const orderLine = await tx.orderLine.findFirstOrThrow({ where: { orderId: order.id } });
          const grn = await tx.goodsReceipt.create({
            data: {
              tenantId: t.id, number: `GRN-2026-${t === tenantA ? 'A' : 'B'}`, purchaseOrderId: po.id, warehouseId: warehouse.id,
              status: 'DRAFT', receiptDate: new Date('2026-11-10T00:00:00.000Z'), currency: 'SAR', subtotalMinor: 10000n, totalCostMinor: 10000n,
              lines: { create: [{ tenantId: t.id, purchaseOrderLineId: poLine.id, itemId: item.id, quantityReceived: 10n, unitCostMinor: 1000n, lineTotalMinor: 10000n, lineOrder: 0 }] },
            },
          });
          const dn = await tx.deliveryNote.create({
            data: {
              tenantId: t.id, number: `DN-2026-${t === tenantA ? 'A' : 'B'}`, salesOrderId: order.id, warehouseId: warehouse.id,
              status: 'DRAFT', deliveryDate: new Date('2026-11-10T00:00:00.000Z'), currency: 'SAR', totalCostMinor: 0n,
              lines: { create: [{ tenantId: t.id, salesOrderLineId: orderLine.id, itemId: item.id, quantity: 2n, unitCostMinor: 1000n, lineTotalMinor: 2000n, lineOrder: 0 }] },
            },
          });
          const adj = await tx.stockAdjustment.create({
            data: {
              tenantId: t.id, number: `ADJ-2026-${t === tenantA ? 'A' : 'B'}`, warehouseId: warehouse.id,
              status: 'DRAFT', adjustmentDate: new Date('2026-11-10T00:00:00.000Z'), currency: 'SAR',
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantityDelta: -1n, unitCostMinor: 1000n, lineTotalMinor: -1000n, reason: 'DAMAGE', lineOrder: 0 }] },
            },
          });
          const trf = await tx.stockTransfer.create({
            data: {
              tenantId: t.id, number: `TRF-2026-${t === tenantA ? 'A' : 'B'}`, fromWarehouseId: warehouse.id, toWarehouseId: warehouse.id,
              status: 'DRAFT', transferDate: new Date('2026-11-10T00:00:00.000Z'), currency: 'SAR',
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantity: 1n, unitCostMinor: 1000n, lineTotalMinor: 1000n, lineOrder: 0 }] },
            },
          });
          const cnt = await tx.stockCount.create({
            data: {
              tenantId: t.id, number: `CNT-2026-${t === tenantA ? 'A' : 'B'}`, warehouseId: warehouse.id,
              status: 'DRAFT', countDate: new Date('2026-11-10T00:00:00.000Z'), currency: 'SAR',
              lines: { create: [{ tenantId: t.id, itemId: item.id, systemQuantity: 10n, countedQuantity: 9n, varianceQuantity: -1n, unitCostMinor: 1000n, lineOrder: 0 }] },
            },
          });
          const terminal = await tx.posTerminal.create({ data: { tenantId: t.id, code: 'POS-1', name: 'Counter 1', branchId: branch.id, warehouseId: warehouse.id, status: 'ACTIVE' } });
          const shift = await tx.posShift.create({ data: { tenantId: t.id, terminalId: terminal.id, cashierId: 'cashier-1', openingFloatMinor: 50000n, status: 'OPEN' } });
          const sale = await tx.posSale.create({
            data: {
              tenantId: t.id, number: `POS-2026-${t === tenantA ? 'A' : 'B'}`, terminalId: terminal.id, shiftId: shift.id, cashierId: 'cashier-1',
              status: 'COMPLETED', saleDate: new Date('2026-11-10T00:00:00.000Z'), currency: 'SAR',
              subtotalMinor: 1000n, taxMinor: 150n, totalMinor: 1150n, cashMinor: 1150n, cardMinor: 0n, cogsMinor: 1000n,
              lines: { create: [{ tenantId: t.id, itemId: item.id, quantity: 1n, unitPriceMinor: 1000n, taxRateBps: 1500, unitCostMinor: 1000n, lineSubtotalMinor: 1000n, lineTaxMinor: 150n, lineTotalMinor: 1150n, lineOrder: 0 }] },
              payments: { create: [{ tenantId: t.id, method: 'CASH', amountMinor: 1150n }] },
            },
          });
          phase56[t.id] = {
            levelId: level.id, layerId: layer.id, movementId: movement.id, grnId: grn.id, dnId: dn.id,
            adjId: adj.id, trfId: trf.id, cntId: cnt.id, terminalId: terminal.id, shiftId: shift.id, saleId: sale.id,
          };
          // Phase 7/8: work centre, BOM + line, work order + line + operation,
          // material issue, production receipt, scrap, department, employee,
          // leave type + request, attendance record, payroll run + line.
          const workCenter = await tx.workCenter.create({ data: { tenantId: t.id, code: 'WC-1', name: 'Packing', standardCostRateMinor: 5000n } });
          const bom = await tx.bom.create({
            data: {
              tenantId: t.id, finishedItemId: item.id, version: 1, status: 'ACTIVE',
              lines: { create: [{ tenantId: t.id, componentItemId: item.id, quantityPerUnit: 2n, scrapBps: 500, workCenterId: workCenter.id, operationName: 'Packing', lineOrder: 0 }] },
            },
            include: { lines: true },
          });
          const bomLine = bom.lines[0];
          const workOrder = await tx.workOrder.create({
            data: {
              tenantId: t.id, number: `WO-2026-${t === tenantA ? 'A' : 'B'}`, finishedItemId: item.id, bomId: bom.id, bomVersion: 1,
              warehouseId: warehouse.id, status: 'RELEASED', qtyPlanned: 10n, qtyProduced: 0n,
              lines: { create: [{ tenantId: t.id, componentItemId: item.id, quantityPerUnit: 2n, scrapBps: 500, workCenterId: workCenter.id, operationName: 'Packing', qtyRequired: 21n, lineOrder: 0 }] },
              operations: { create: [{ tenantId: t.id, name: 'Packing', workCenterId: workCenter.id, plannedHours: 8 }] },
            },
            include: { lines: true, operations: true },
          });
          const workOrderLine = workOrder.lines[0];
          const operation = workOrder.operations[0];
          const issue = await tx.materialIssue.create({
            data: {
              tenantId: t.id, number: `MI-2026-${t === tenantA ? 'A' : 'B'}`, workOrderId: workOrder.id, warehouseId: warehouse.id,
              status: 'DRAFT', issueDate: new Date('2026-11-10T00:00:00.000Z'), currency: 'SAR',
              lines: { create: [{ tenantId: t.id, workOrderLineId: workOrderLine.id, itemId: item.id, quantity: 5n, unitCostMinor: 1000n, lineTotalMinor: 5000n, lineOrder: 0 }] },
            },
          });
          const receipt = await tx.productionReceipt.create({
            data: { tenantId: t.id, number: `PR-2026-${t === tenantA ? 'A' : 'B'}`, workOrderId: workOrder.id, warehouseId: warehouse.id, status: 'DRAFT', receiptDate: new Date('2026-11-10T00:00:00.000Z'), quantity: 2n, currency: 'SAR' },
          });
          const scrap = await tx.scrap.create({
            data: { tenantId: t.id, number: `SCR-2026-${t === tenantA ? 'A' : 'B'}`, workOrderId: workOrder.id, kind: 'FINISHED', itemId: item.id, warehouseId: warehouse.id, quantity: 1n, reason: 'Damaged', scrapDate: new Date('2026-11-10T00:00:00.000Z'), status: 'DRAFT', currency: 'SAR' },
          });
          const department = await tx.department.create({ data: { tenantId: t.id, code: 'HR', name: 'HR' } });
          const employee = await tx.employee.create({
            data: { tenantId: t.id, code: 'EMP-1', name: `Employee ${t.slug}`, jobTitle: 'Worker', departmentId: department.id, branchId: branch.id, hireDate: new Date('2023-01-15T00:00:00.000Z'), basicSalaryMinor: 1000000n, housingAllowanceMinor: 200000n, nationality: 'SAUDI' },
          });
          const leaveType = await tx.leaveType.create({ data: { tenantId: t.id, code: 'ANNUAL', name: 'Annual Leave', daysPerYear: 30 } });
          const leaveRequest = await tx.leaveRequest.create({
            data: { tenantId: t.id, employeeId: employee.id, leaveTypeId: leaveType.id, startDate: new Date('2026-11-15T00:00:00.000Z'), endDate: new Date('2026-11-17T00:00:00.000Z'), days: 3, status: 'PENDING' },
          });
          const attendance = await tx.attendanceRecord.create({
            data: { tenantId: t.id, employeeId: employee.id, date: new Date('2026-11-10T00:00:00.000Z'), checkIn: '08:00', checkOut: '17:00', status: 'PRESENT' },
          });
          const payrollRun = await tx.payrollRun.create({
            data: {
              tenantId: t.id, periodYear: 2026, periodMonth: 11, status: 'CALCULATED', currency: 'SAR',
              grossMinor: 1200000n, deductionsMinor: 117000n, netMinor: 1083000n, gosiEmployerMinor: 141000n, eosbMinor: 50000n,
              lines: { create: [{ tenantId: t.id, employeeId: employee.id, basicSalaryMinor: 1000000n, allowancesMinor: 200000n, grossMinor: 1200000n, gosiEmployeeMinor: 117000n, netMinor: 1083000n, gosiEmployerMinor: 141000n, eosbAccrualMinor: 50000n, workingDays: 22 }] },
            },
            include: { lines: true },
          });
          phase78[t.id] = {
            workCenterId: workCenter.id, bomId: bom.id, bomLineId: bomLine.id,
            workOrderId: workOrder.id, workOrderLineId: workOrderLine.id, operationId: operation.id,
            issueId: issue.id, receiptId: receipt.id, scrapId: scrap.id,
            departmentId: department.id, employeeId: employee.id, leaveTypeId: leaveType.id,
            leaveRequestId: leaveRequest.id, attendanceId: attendance.id,
            payrollRunId: payrollRun.id, payrollLineId: payrollRun.lines[0].id,
          };
          // Phase 9/10: project, task, approved timesheet, expense,
          // milestone and a report snapshot per tenant.
          const project = await tx.project.create({
            data: { tenantId: t.id, code: `PRJ-${suffix}`, name: `Project ${t.slug}`, customerId: contact.id, status: 'ACTIVE', billingType: 'MILESTONE', budgetMinor: 1000000n, startDate: new Date('2026-11-01T00:00:00.000Z') },
          });
          const task = await tx.projectTask.create({
            data: { tenantId: t.id, projectId: project.id, title: `Task ${t.slug}`, assigneeId: employee.id, status: 'IN_PROGRESS', estimatedMinutes: 480 },
          });
          const timesheet = await tx.timesheet.create({
            data: { tenantId: t.id, employeeId: employee.id, projectId: project.id, taskId: task.id, date: new Date('2026-11-10T00:00:00.000Z'), minutesInt: 480, status: 'APPROVED' },
          });
          const expense = await tx.projectExpense.create({
            data: { tenantId: t.id, projectId: project.id, date: new Date('2026-11-11T00:00:00.000Z'), category: 'TRAVEL', amountMinor: 50000n, status: 'APPROVED' },
          });
          const milestone = await tx.milestone.create({
            data: { tenantId: t.id, projectId: project.id, title: `Milestone ${t.slug}`, amountMinor: 200000n, status: 'PENDING' },
          });
          const snapshot = await tx.reportSnapshot.create({
            data: { tenantId: t.id, type: 'PROFIT_LOSS', parameters: { from: '2026-11-01', to: '2026-11-30' }, format: 'CSV', content: { revenueMinor: 100000 } },
          });
          phase910[t.id] = { projectId: project.id, taskId: task.id, timesheetId: timesheet.id, expenseId: expense.id, milestoneId: milestone.id, snapshotId: snapshot.id };
        });
      }

      // Read as tenant A: only tenant A's user must be visible.
      const visibleAsA = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        return tx.user.findMany({ where: { email: { contains: suffix } } });
      });
      expect(visibleAsA).toHaveLength(1);
      expect(visibleAsA[0].tenantId).toBe(tenantA.id);

      // Read as tenant B: only tenant B's user must be visible.
      const visibleAsB = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantB.id}'`);
        return tx.user.findMany({ where: { email: { contains: suffix } } });
      });
      expect(visibleAsB).toHaveLength(1);
      expect(visibleAsB[0].tenantId).toBe(tenantB.id);

      // With no tenant context set, RLS must hide everything ('' != any tenantId).
      const visibleNone = await prisma.user.findMany({ where: { email: { contains: suffix } } });
      expect(visibleNone).toHaveLength(0);

      // Phase 1: tenant A must see only its own contacts/items/price lists.
      const masterAsA = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [contacts, items, lists] = await Promise.all([
          tx.contact.findMany({}),
          tx.item.findMany({ where: { sku: `SKU-${suffix}` } }),
          tx.priceList.findMany({}),
        ]);
        return { contacts, items, lists };
      });
      expect(masterAsA.contacts.map((c) => c.id)).toEqual([phase1[tenantA.id].contactId]);
      expect(masterAsA.items.map((i) => i.id)).toEqual([phase1[tenantA.id].itemId]);
      expect(masterAsA.lists.map((l) => l.id)).toEqual([phase1[tenantA.id].listId]);

      // Tenant B's contact/item must be invisible to A even by direct id lookup.
      const crossRead = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [contactB, itemB] = await Promise.all([
          tx.contact.findUnique({ where: { id: phase1[tenantB.id].contactId } }),
          tx.item.findUnique({ where: { id: phase1[tenantB.id].itemId } }),
        ]);
        return { contactB, itemB };
      });
      expect(crossRead.contactB).toBeNull();
      expect(crossRead.itemB).toBeNull();

      // With no tenant context, Phase 1 tables must also hide everything.
      expect(await prisma.contact.findMany({ where: { id: phase1[tenantA.id].contactId } })).toHaveLength(0);
      expect(await prisma.item.findMany({ where: { sku: `SKU-${suffix}` } })).toHaveLength(0);

      // Phase 2: tenant A must see only its own periods, journals, cost
      // centres and opening balances.
      const acctAsA = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [periods, entries, costCenters, openings] = await Promise.all([
          tx.fiscalPeriod.findMany({}),
          tx.journalEntry.findMany({}),
          tx.costCenter.findMany({}),
          tx.openingBalance.findMany({}),
        ]);
        return { periods, entries, costCenters, openings };
      });
      expect(acctAsA.periods.map((p) => p.id)).toEqual([phase2[tenantA.id].periodId]);
      expect(acctAsA.entries.map((e) => e.id)).toEqual([phase2[tenantA.id].entryId]);
      expect(acctAsA.costCenters.map((c) => c.id)).toEqual([phase2[tenantA.id].costCenterId]);
      expect(acctAsA.openings).toHaveLength(1);
      expect(acctAsA.openings[0].tenantId).toBe(tenantA.id);

      // Tenant B's journal, period and cost centre must be invisible to A
      // even by direct id lookup — including the journal's lines.
      const crossAcct = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [entryB, periodB, ccB, linesB] = await Promise.all([
          tx.journalEntry.findUnique({ where: { id: phase2[tenantB.id].entryId } }),
          tx.fiscalPeriod.findUnique({ where: { id: phase2[tenantB.id].periodId } }),
          tx.costCenter.findUnique({ where: { id: phase2[tenantB.id].costCenterId } }),
          tx.journalEntryLine.findMany({ where: { entryId: phase2[tenantB.id].entryId } }),
        ]);
        return { entryB, periodB, ccB, linesB };
      });
      expect(crossAcct.entryB).toBeNull();
      expect(crossAcct.periodB).toBeNull();
      expect(crossAcct.ccB).toBeNull();
      expect(crossAcct.linesB).toHaveLength(0);

      // With no tenant context, Phase 2 tables must also hide everything.
      expect(await prisma.journalEntry.findMany({ where: { id: phase2[tenantA.id].entryId } })).toHaveLength(0);
      expect(await prisma.fiscalPeriod.findMany({ where: { id: phase2[tenantA.id].periodId } })).toHaveLength(0);

      // Phase 3/4: tenant A must see only its own leads, opportunities,
      // quotes, orders, sales invoices, purchase orders, supplier invoices.
      const salesAsA = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [leads, opps, quotes, orders, salesInvoices, pos, supInvoices] = await Promise.all([
          tx.lead.findMany({}),
          tx.opportunity.findMany({}),
          tx.salesQuote.findMany({}),
          tx.salesOrder.findMany({}),
          tx.salesInvoice.findMany({}),
          tx.purchaseOrder.findMany({}),
          tx.supplierInvoice.findMany({}),
        ]);
        return { leads, opps, quotes, orders, salesInvoices, pos, supInvoices };
      });
      expect(salesAsA.leads.map((l) => l.id)).toEqual([phase34[tenantA.id].leadId]);
      expect(salesAsA.opps.map((o) => o.id)).toEqual([phase34[tenantA.id].oppId]);
      expect(salesAsA.quotes.map((q) => q.id)).toEqual([phase34[tenantA.id].quoteId]);
      expect(salesAsA.orders.map((o) => o.id)).toEqual([phase34[tenantA.id].orderId]);
      expect(salesAsA.salesInvoices.map((i) => i.id)).toEqual([phase34[tenantA.id].salesInvoiceId]);
      expect(salesAsA.pos.map((p) => p.id)).toEqual([phase34[tenantA.id].poId]);
      expect(salesAsA.supInvoices.map((i) => i.id)).toEqual([phase34[tenantA.id].supInvoiceId]);

      // Tenant B's Phase 3/4 rows must be invisible to A even by direct id.
      const crossSales = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [leadB, quoteB, invoiceB, poB, supInvB, quoteLinesB] = await Promise.all([
          tx.lead.findUnique({ where: { id: phase34[tenantB.id].leadId } }),
          tx.salesQuote.findUnique({ where: { id: phase34[tenantB.id].quoteId } }),
          tx.salesInvoice.findUnique({ where: { id: phase34[tenantB.id].salesInvoiceId } }),
          tx.purchaseOrder.findUnique({ where: { id: phase34[tenantB.id].poId } }),
          tx.supplierInvoice.findUnique({ where: { id: phase34[tenantB.id].supInvoiceId } }),
          tx.quoteLine.findMany({ where: { quoteId: phase34[tenantB.id].quoteId } }),
        ]);
        return { leadB, quoteB, invoiceB, poB, supInvB, quoteLinesB };
      });
      expect(crossSales.leadB).toBeNull();
      expect(crossSales.quoteB).toBeNull();
      expect(crossSales.invoiceB).toBeNull();
      expect(crossSales.poB).toBeNull();
      expect(crossSales.supInvB).toBeNull();
      expect(crossSales.quoteLinesB).toHaveLength(0);

      // With no tenant context, Phase 3/4 tables must also hide everything.
      expect(await prisma.lead.findMany({ where: { id: phase34[tenantA.id].leadId } })).toHaveLength(0);
      expect(await prisma.salesInvoice.findMany({ where: { id: phase34[tenantA.id].salesInvoiceId } })).toHaveLength(0);
      expect(await prisma.purchaseOrder.findMany({ where: { id: phase34[tenantA.id].poId } })).toHaveLength(0);
      expect(await prisma.supplierInvoice.findMany({ where: { id: phase34[tenantA.id].supInvoiceId } })).toHaveLength(0);

      // Phase 5/6: tenant A must see only its own stock, documents and POS rows.
      const invAsA = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [levels, layers, movements, grns, dns, adjs, trfs, cnts, terminals, shifts, sales] = await Promise.all([
          tx.stockLevel.findMany({}),
          tx.stockCostLayer.findMany({}),
          tx.stockMovement.findMany({}),
          tx.goodsReceipt.findMany({}),
          tx.deliveryNote.findMany({}),
          tx.stockAdjustment.findMany({}),
          tx.stockTransfer.findMany({}),
          tx.stockCount.findMany({}),
          tx.posTerminal.findMany({}),
          tx.posShift.findMany({}),
          tx.posSale.findMany({}),
        ]);
        return { levels, layers, movements, grns, dns, adjs, trfs, cnts, terminals, shifts, sales };
      });
      expect(invAsA.levels.map((l) => l.id)).toEqual([phase56[tenantA.id].levelId]);
      expect(invAsA.layers.map((l) => l.id)).toEqual([phase56[tenantA.id].layerId]);
      expect(invAsA.movements.map((m) => m.id)).toEqual([phase56[tenantA.id].movementId]);
      expect(invAsA.grns.map((g) => g.id)).toEqual([phase56[tenantA.id].grnId]);
      expect(invAsA.dns.map((d) => d.id)).toEqual([phase56[tenantA.id].dnId]);
      expect(invAsA.adjs.map((a) => a.id)).toEqual([phase56[tenantA.id].adjId]);
      expect(invAsA.trfs.map((x) => x.id)).toEqual([phase56[tenantA.id].trfId]);
      expect(invAsA.cnts.map((c) => c.id)).toEqual([phase56[tenantA.id].cntId]);
      expect(invAsA.terminals.map((x) => x.id)).toEqual([phase56[tenantA.id].terminalId]);
      expect(invAsA.shifts.map((x) => x.id)).toEqual([phase56[tenantA.id].shiftId]);
      expect(invAsA.sales.map((x) => x.id)).toEqual([phase56[tenantA.id].saleId]);

      // Tenant B's Phase 5/6 rows must be invisible to A even by direct id.
      const crossInv = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [levelB, movementB, grnB, dnB, adjB, trfB, cntB, terminalB, shiftB, saleB] = await Promise.all([
          tx.stockLevel.findUnique({ where: { id: phase56[tenantB.id].levelId } }),
          tx.stockMovement.findUnique({ where: { id: phase56[tenantB.id].movementId } }),
          tx.goodsReceipt.findUnique({ where: { id: phase56[tenantB.id].grnId } }),
          tx.deliveryNote.findUnique({ where: { id: phase56[tenantB.id].dnId } }),
          tx.stockAdjustment.findUnique({ where: { id: phase56[tenantB.id].adjId } }),
          tx.stockTransfer.findUnique({ where: { id: phase56[tenantB.id].trfId } }),
          tx.stockCount.findUnique({ where: { id: phase56[tenantB.id].cntId } }),
          tx.posTerminal.findUnique({ where: { id: phase56[tenantB.id].terminalId } }),
          tx.posShift.findUnique({ where: { id: phase56[tenantB.id].shiftId } }),
          tx.posSale.findUnique({ where: { id: phase56[tenantB.id].saleId } }),
        ]);
        return { levelB, movementB, grnB, dnB, adjB, trfB, cntB, terminalB, shiftB, saleB };
      });
      expect(crossInv.levelB).toBeNull();
      expect(crossInv.movementB).toBeNull();
      expect(crossInv.grnB).toBeNull();
      expect(crossInv.dnB).toBeNull();
      expect(crossInv.adjB).toBeNull();
      expect(crossInv.trfB).toBeNull();
      expect(crossInv.cntB).toBeNull();
      expect(crossInv.terminalB).toBeNull();
      expect(crossInv.shiftB).toBeNull();
      expect(crossInv.saleB).toBeNull();

      // With no tenant context, Phase 5/6 tables must also hide everything.
      expect(await prisma.stockLevel.findMany({ where: { id: phase56[tenantA.id].levelId } })).toHaveLength(0);
      expect(await prisma.goodsReceipt.findMany({ where: { id: phase56[tenantA.id].grnId } })).toHaveLength(0);
      expect(await prisma.posSale.findMany({ where: { id: phase56[tenantA.id].saleId } })).toHaveLength(0);

      // Phase 7/8: tenant A must see only its own manufacturing + HR rows.
      const mfgAsA = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [workCenters, boms, bomLines, workOrders, woLines, operations, issues, receipts, scraps, departments, employees, leaveTypes, leaveRequests, attendance, payrollRuns, payrollLines] = await Promise.all([
          tx.workCenter.findMany({}),
          tx.bom.findMany({}),
          tx.bomLine.findMany({}),
          tx.workOrder.findMany({}),
          tx.workOrderLine.findMany({}),
          tx.workOrderOperation.findMany({}),
          tx.materialIssue.findMany({}),
          tx.productionReceipt.findMany({}),
          tx.scrap.findMany({}),
          tx.department.findMany({}),
          tx.employee.findMany({}),
          tx.leaveType.findMany({}),
          tx.leaveRequest.findMany({}),
          tx.attendanceRecord.findMany({}),
          tx.payrollRun.findMany({}),
          tx.payrollLine.findMany({}),
        ]);
        return { workCenters, boms, bomLines, workOrders, woLines, operations, issues, receipts, scraps, departments, employees, leaveTypes, leaveRequests, attendance, payrollRuns, payrollLines };
      });
      const p78a = phase78[tenantA.id];
      expect(mfgAsA.workCenters.map((x) => x.id)).toEqual([p78a.workCenterId]);
      expect(mfgAsA.boms.map((x) => x.id)).toEqual([p78a.bomId]);
      expect(mfgAsA.bomLines.map((x) => x.id)).toEqual([p78a.bomLineId]);
      expect(mfgAsA.workOrders.map((x) => x.id)).toEqual([p78a.workOrderId]);
      expect(mfgAsA.woLines.map((x) => x.id)).toEqual([p78a.workOrderLineId]);
      expect(mfgAsA.operations.map((x) => x.id)).toEqual([p78a.operationId]);
      expect(mfgAsA.issues.map((x) => x.id)).toEqual([p78a.issueId]);
      expect(mfgAsA.receipts.map((x) => x.id)).toEqual([p78a.receiptId]);
      expect(mfgAsA.scraps.map((x) => x.id)).toEqual([p78a.scrapId]);
      expect(mfgAsA.departments.map((x) => x.id)).toEqual([p78a.departmentId]);
      expect(mfgAsA.employees.map((x) => x.id)).toEqual([p78a.employeeId]);
      expect(mfgAsA.leaveTypes.map((x) => x.id)).toEqual([p78a.leaveTypeId]);
      expect(mfgAsA.leaveRequests.map((x) => x.id)).toEqual([p78a.leaveRequestId]);
      expect(mfgAsA.attendance.map((x) => x.id)).toEqual([p78a.attendanceId]);
      expect(mfgAsA.payrollRuns.map((x) => x.id)).toEqual([p78a.payrollRunId]);
      expect(mfgAsA.payrollLines.map((x) => x.id)).toEqual([p78a.payrollLineId]);

      // Tenant B's Phase 7/8 rows must be invisible to A even by direct id.
      const p78b = phase78[tenantB.id];
      const crossMfg = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [wcB, bomB, woB, issueB, receiptB, scrapB, deptB, empB, leaveB, attB, runB] = await Promise.all([
          tx.workCenter.findUnique({ where: { id: p78b.workCenterId } }),
          tx.bom.findUnique({ where: { id: p78b.bomId } }),
          tx.workOrder.findUnique({ where: { id: p78b.workOrderId } }),
          tx.materialIssue.findUnique({ where: { id: p78b.issueId } }),
          tx.productionReceipt.findUnique({ where: { id: p78b.receiptId } }),
          tx.scrap.findUnique({ where: { id: p78b.scrapId } }),
          tx.department.findUnique({ where: { id: p78b.departmentId } }),
          tx.employee.findUnique({ where: { id: p78b.employeeId } }),
          tx.leaveRequest.findUnique({ where: { id: p78b.leaveRequestId } }),
          tx.attendanceRecord.findUnique({ where: { id: p78b.attendanceId } }),
          tx.payrollRun.findUnique({ where: { id: p78b.payrollRunId } }),
        ]);
        return { wcB, bomB, woB, issueB, receiptB, scrapB, deptB, empB, leaveB, attB, runB };
      });
      expect(crossMfg.wcB).toBeNull();
      expect(crossMfg.bomB).toBeNull();
      expect(crossMfg.woB).toBeNull();
      expect(crossMfg.issueB).toBeNull();
      expect(crossMfg.receiptB).toBeNull();
      expect(crossMfg.scrapB).toBeNull();
      expect(crossMfg.deptB).toBeNull();
      expect(crossMfg.empB).toBeNull();
      expect(crossMfg.leaveB).toBeNull();
      expect(crossMfg.attB).toBeNull();
      expect(crossMfg.runB).toBeNull();

      // With no tenant context, Phase 7/8 tables must also hide everything.
      expect(await prisma.workOrder.findMany({ where: { id: p78a.workOrderId } })).toHaveLength(0);
      expect(await prisma.employee.findMany({ where: { id: p78a.employeeId } })).toHaveLength(0);
      expect(await prisma.payrollRun.findMany({ where: { id: p78a.payrollRunId } })).toHaveLength(0);

      // Phase 9/10: tenant A must see only its own projects, tasks,
      // timesheets, expenses, milestones and snapshots.
      const p910a = phase910[tenantA.id];
      const p910b = phase910[tenantB.id];
      const projAsA = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [projects, tasks, timesheets, expenses, milestones, snapshots] = await Promise.all([
          tx.project.findMany({}),
          tx.projectTask.findMany({}),
          tx.timesheet.findMany({}),
          tx.projectExpense.findMany({}),
          tx.milestone.findMany({}),
          tx.reportSnapshot.findMany({}),
        ]);
        return { projects, tasks, timesheets, expenses, milestones, snapshots };
      });
      expect(projAsA.projects.map((x) => x.id)).toEqual([p910a.projectId]);
      expect(projAsA.tasks.map((x) => x.id)).toEqual([p910a.taskId]);
      expect(projAsA.timesheets.map((x) => x.id)).toEqual([p910a.timesheetId]);
      expect(projAsA.expenses.map((x) => x.id)).toEqual([p910a.expenseId]);
      expect(projAsA.milestones.map((x) => x.id)).toEqual([p910a.milestoneId]);
      expect(projAsA.snapshots.map((x) => x.id)).toEqual([p910a.snapshotId]);

      // Tenant B's Phase 9/10 rows must be invisible to A even by direct id.
      const crossProj = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
        const [projectB, taskB, timesheetB, expenseB, milestoneB, snapshotB] = await Promise.all([
          tx.project.findUnique({ where: { id: p910b.projectId } }),
          tx.projectTask.findUnique({ where: { id: p910b.taskId } }),
          tx.timesheet.findUnique({ where: { id: p910b.timesheetId } }),
          tx.projectExpense.findUnique({ where: { id: p910b.expenseId } }),
          tx.milestone.findUnique({ where: { id: p910b.milestoneId } }),
          tx.reportSnapshot.findUnique({ where: { id: p910b.snapshotId } }),
        ]);
        return { projectB, taskB, timesheetB, expenseB, milestoneB, snapshotB };
      });
      expect(crossProj.projectB).toBeNull();
      expect(crossProj.taskB).toBeNull();
      expect(crossProj.timesheetB).toBeNull();
      expect(crossProj.expenseB).toBeNull();
      expect(crossProj.milestoneB).toBeNull();
      expect(crossProj.snapshotB).toBeNull();

      // With no tenant context, Phase 9/10 tables must also hide everything.
      expect(await prisma.project.findMany({ where: { id: p910a.projectId } })).toHaveLength(0);
      expect(await prisma.timesheet.findMany({ where: { id: p910a.timesheetId } })).toHaveLength(0);
      expect(await prisma.reportSnapshot.findMany({ where: { id: p910a.snapshotId } })).toHaveLength(0);
    } finally {
      // Clean up via the bootstrap context (RLS would otherwise hide the rows).
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.bootstrap = 'eserp-login'`);
        await tx.timesheet.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.projectExpense.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.milestone.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.projectTask.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.project.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.reportSnapshot.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.payrollLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.payrollRun.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.attendanceRecord.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.leaveRequest.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.leaveType.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.employee.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.department.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.scrap.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.productionReceipt.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.materialIssueLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.materialIssue.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.workOrderOperation.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.workOrderLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.workOrder.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.bomLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.bom.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.workCenter.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.posSalePayment.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.posSaleLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.posSale.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.posShift.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.posTerminal.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockCountLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockCount.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockTransferLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockTransfer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockAdjustmentLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockAdjustment.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.deliveryNoteLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.deliveryNote.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.goodsReceiptLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.goodsReceipt.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockMovement.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockCostLayer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.stockLevel.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.warehouse.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.branch.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.supplierInvoiceLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.supplierInvoice.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.purchaseOrderLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.purchaseOrder.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.salesInvoiceLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.salesInvoice.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.orderLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.salesOrder.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.quoteLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.salesQuote.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.opportunity.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.lead.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.journalEntryLine.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.journalEntry.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.openingBalance.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.fiscalPeriod.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.costCenter.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.chartOfAccounts.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.priceListItem.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.item.deleteMany({ where: { sku: `SKU-${suffix}` } }).catch(() => undefined);
        await tx.contact.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.itemCategory.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.priceList.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
        await tx.unitOfMeasure.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } }).catch(() => undefined);
      }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { email: { contains: suffix } } }).catch(() => undefined);
      await prisma.tenant.deleteMany({ where: { slug: { in: [tenantA.slug, tenantB.slug] } } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });
});
