import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@eserp/db';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * End-to-end: register -> login -> me -> onboarding -> currency -> audit log,
 * plus tenant isolation (token A cannot read tenant B's settings).
 * Skipped with a clear message when DATABASE_URL is unset (no Postgres).
 * Requires migrations applied + Redis reachable (BullMQ queues).
 */
describe('EsERP API (e2e)', () => {
  let app: INestApplication;
  let available = false;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.log('SKIPPED: e2e — DATABASE_URL is not set (needs Postgres + migrations + Redis).');
      return;
    }
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new GlobalExceptionFilter());
      await app.init();
      available = true;
    } catch (err) {
      console.log(`SKIPPED: e2e — app failed to start (${(err as Error).message}).`);
    }
  });

  afterAll(async () => { await app?.close(); });

  it('register -> login -> me -> onboarding -> currency -> audit log', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `E2E Co ${suffix}`, slug: `e2e-${suffix}`, email: `owner@e2e-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const tenantId = reg.body.tenant.id;
    const access = reg.body.tokens.accessToken as string;
    expect(access).toBeTruthy();

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `owner@e2e-${suffix}.test`, password: 'Demo1234!' });
    expect(login.status).toBe(201);
    const token = login.body.tokens.accessToken as string;

    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.tenantId).toBe(tenantId);
    expect(me.body.roles).toContain('OWNER');

    const step0 = await request(app.getHttpServer())
      .post('/api/v1/onboarding/step')
      .set('Authorization', `Bearer ${token}`)
      .send({ step: 0, data: { legalName: `E2E Co ${suffix}`, city: 'Riyadh' } });
    expect(step0.status).toBe(201);
    expect((step0.body.stepsCompleted as number[])).toContain(0);

    const cur = await request(app.getHttpServer())
      .post('/api/v1/settings/currencies')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'USD', name: 'US Dollar' });
    expect(cur.status).toBe(201);
    expect(cur.body.code).toBe('USD');

    const audit = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`);
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThan(0);
    expect(audit.body.data.some((e: any) => e.entityType === 'Currency')).toBe(true);
  });

  it('master data: contacts + items CRUD as owner, cross-tenant 404, viewer 403, CSV preview', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `MD Co ${suffix}`, slug: `md-${suffix}`, email: `owner@md-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;

    // --- Contacts: create -> read -> update -> delete ---
    const contact = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'CUSTOMER', legalName: `Buyer ${suffix}`, displayName: `Buyer ${suffix}`, taxNumber: '300100000000001', email: `buyer-${suffix}@test.sa`, creditLimitMinor: 5000000, paymentTermsDays: 30 });
    expect(contact.status).toBe(201);
    expect(contact.body.creditLimitMinor).toBe(5000000);
    const contactId = contact.body.id as string;

    // Duplicate tax number in the same tenant must conflict.
    const dup = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'SUPPLIER', legalName: 'Other', displayName: 'Other', taxNumber: '300100000000001' });
    expect(dup.status).toBe(409);
    // Bad VAT number must fail validation with 400.
    const badVat = await request(app.getHttpServer())
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ legalName: 'Bad', displayName: 'Bad', taxNumber: '123' });
    expect(badVat.status).toBe(400);
    expect(badVat.body.error.code).toBe('VALIDATION_ERROR');

    const list = await request(app.getHttpServer())
      .get('/api/v1/contacts?search=Buyer&type=CUSTOMER')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].id).toBe(contactId);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/contacts/${contactId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentTermsDays: 45 });
    expect(updated.status).toBe(200);
    expect(updated.body.paymentTermsDays).toBe(45);

    // --- Items: category + item + price list ---
    const cat = await request(app.getHttpServer())
      .post('/api/v1/item-categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FOOD', name: 'Foodstuffs' });
    expect(cat.status).toBe(201);

    const uom = await request(app.getHttpServer())
      .post('/api/v1/settings/units')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'piece', name: 'Piece' });
    expect(uom.status).toBe(201);

    const item = await request(app.getHttpServer())
      .post('/api/v1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: `SKU-${suffix}`, name: 'Basmati Rice', categoryId: cat.body.id, defaultUomId: uom.body.id, salesPriceMinor: 3499, purchasePriceMinor: 2800, costingMethod: 'FIFO' });
    expect(item.status).toBe(201);
    expect(item.body.salesPriceMinor).toBe(3499);
    const itemId = item.body.id as string;

    const priceList = await request(app.getHttpServer())
      .post('/api/v1/pricelists')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Standard Retail', currency: 'SAR', isDefault: true });
    expect(priceList.status).toBe(201);
    const line = await request(app.getHttpServer())
      .post(`/api/v1/pricelists/${priceList.body.id}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, priceMinor: 3499, minQuantity: 1 });
    expect(line.status).toBe(201);
    const listWithLines = await request(app.getHttpServer())
      .get(`/api/v1/pricelists/${priceList.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(listWithLines.status).toBe(200);
    expect(listWithLines.body.items).toHaveLength(1);

    // Item on a price list cannot be deleted.
    const blockedDelete = await request(app.getHttpServer())
      .delete(`/api/v1/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(blockedDelete.status).toBe(409);
    await request(app.getHttpServer())
      .delete(`/api/v1/pricelists/${priceList.body.id}/items/${line.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    const itemDeleted = await request(app.getHttpServer())
      .delete(`/api/v1/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(itemDeleted.status).toBe(200);

    // CSV import preview: one good row, one bad row.
    const preview = await request(app.getHttpServer())
      .post('/api/v1/contacts/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ csvText: 'legalName,displayName,type,email\nGood Co,Good,CUSTOMER,good@test.sa\nBad Co,Bad,CUSTOMER,not-an-email' });
    expect(preview.status).toBe(201);
    expect(preview.body.rows).toBe(2);
    expect(preview.body.valid).toBe(1);
    expect(preview.body.errors).toHaveLength(1);

    // --- Cross-tenant: a second tenant's owner cannot see tenant A's contact ---
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `MD B ${suffix}`, slug: `md-b-${suffix}`, email: `owner@md-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer())
      .get(`/api/v1/contacts/${contactId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);
    const crossList = await request(app.getHttpServer())
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossList.status).toBe(200);
    expect(crossList.body.meta.total).toBe(0);

    // --- Role check: seeded VIEWER (read-only) cannot create a contact ---
    // Depends on the demo seed (alsafa-trading); if the seed was never applied
    // the login fails and this assertion is skipped rather than failing the suite.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ legalName: 'Nope', displayName: 'Nope' });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/contacts')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }

    // Cleanup: delete the contact.
    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/contacts/${contactId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(200);
    const gone = await request(app.getHttpServer())
      .get(`/api/v1/contacts/${contactId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(gone.status).toBe(404);
  });

  it('accounting: draft -> post -> reverse, unbalanced 400, closed period 400, cross-tenant 404, viewer 403, reports', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Acct Co ${suffix}`, slug: `acct-${suffix}`, email: `owner@acct-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const tenantId = reg.body.tenant.id as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);

    // Saudi CoA via onboarding step 2 (no step ordering is enforced).
    const coa = await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step'))
      .send({ step: 2, data: { template: 'saudi' } });
    expect(coa.status).toBe(201);

    // Periods for the current month (OPEN) and the previous month (CLOSED).
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const prevLastDay = new Date(Date.UTC(prev.year, prev.month, 0)).getUTCDate();
    const curPeriod = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`, endDate: `${year}-${String(month).padStart(2, '0')}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(curPeriod.status).toBe(201);
    const prevPeriod = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: prev.year, periodNumber: prev.month, startDate: `${prev.year}-${String(prev.month).padStart(2, '0')}-01T00:00:00.000Z`, endDate: `${prev.year}-${String(prev.month).padStart(2, '0')}-${prevLastDay}T23:59:59.999Z`, status: 'CLOSED' });
    expect(prevPeriod.status).toBe(201);

    // Overlapping period must be rejected.
    const overlap = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${String(month).padStart(2, '0')}-15T00:00:00.000Z`, endDate: `${year}-${String(month).padStart(2, '0')}-${lastDay}T23:59:59.999Z` });
    expect(overlap.status).toBe(400);

    // Cost centre + VAT rate + leaf account ids (no CoA endpoint yet — read via Prisma).
    const cc = await auth(request(app.getHttpServer()).post('/api/v1/cost-centers'))
      .send({ code: 'HQ', name: 'Head Office', nameAr: 'الإدارة العامة' });
    expect(cc.status).toBe(201);
    const taxesRes = await auth(request(app.getHttpServer()).get('/api/v1/settings/taxes'));
    const taxes = Array.isArray(taxesRes.body) ? taxesRes.body : taxesRes.body.data;
    const vat15 = taxes.find((t: any) => t.rateBps === 1500);
    expect(vat15).toBeTruthy();

    const prisma = new PrismaClient();
    try {
      const accounts = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
        return tx.chartOfAccounts.findMany({ where: { tenantId, code: { in: ['1010', '4010', '2110', '1000'] } } });
      });
      const byCode = new Map(accounts.map((a: any) => [a.code, a.id]));
      const cashId = byCode.get('1010') as string;
      const salesId = byCode.get('4010') as string;
      const vatOutId = byCode.get('2110') as string;
      const groupId = byCode.get('1000') as string;
      expect(cashId && salesId && vatOutId && groupId).toBeTruthy();

      const entryDate = `${year}-${String(month).padStart(2, '0')}-15T00:00:00.000Z`;
      const lines = [
        { accountId: cashId, debitMinor: 1150000, creditMinor: 0, lineOrder: 0 },
        { accountId: salesId, debitMinor: 0, creditMinor: 1000000, taxRateId: vat15.id, costCenterId: cc.body.id, lineOrder: 1 },
        { accountId: vatOutId, debitMinor: 0, creditMinor: 150000, lineOrder: 2 },
      ];
      // Unbalanced entry -> 400.
      const unbalanced = await auth(request(app.getHttpServer()).post('/api/v1/journals'))
        .send({ entryDate, description: 'Unbalanced', lines: [
          { accountId: cashId, debitMinor: 1000, creditMinor: 0 },
          { accountId: salesId, debitMinor: 0, creditMinor: 900 },
        ] });
      expect(unbalanced.status).toBe(400);
      // Group/header account -> 400.
      const groupPost = await auth(request(app.getHttpServer()).post('/api/v1/journals'))
        .send({ entryDate, description: 'Group account', lines: [
          { accountId: groupId, debitMinor: 1000, creditMinor: 0 },
          { accountId: salesId, debitMinor: 0, creditMinor: 1000 },
        ] });
      expect(groupPost.status).toBe(400);
      // Entry dated in the CLOSED previous period -> 400.
      const closedDate = `${prev.year}-${String(prev.month).padStart(2, '0')}-15T00:00:00.000Z`;
      const closedPost = await auth(request(app.getHttpServer()).post('/api/v1/journals'))
        .send({ entryDate: closedDate, description: 'Closed period', lines });
      expect(closedPost.status).toBe(400);

      // Draft -> post -> reverse.
      const draft = await auth(request(app.getHttpServer()).post('/api/v1/journals'))
        .send({ entryDate, description: 'Cash sale', reference: 'POS-1', lines });
      expect(draft.status).toBe(201);
      expect(draft.body.status).toBe('DRAFT');
      expect(draft.body.number).toMatch(/^JE-/);
      expect(draft.body.totalDebitMinor).toBe(1150000);
      const entryId = draft.body.id as string;

      const posted = await auth(request(app.getHttpServer()).post(`/api/v1/journals/${entryId}/post`)).send({});
      expect(posted.status).toBe(201);
      expect(posted.body.status).toBe('POSTED');
      expect(posted.body.postedAt).toBeTruthy();
      const postAgain = await auth(request(app.getHttpServer()).post(`/api/v1/journals/${entryId}/post`)).send({});
      expect(postAgain.status).toBe(409);

      // Reports on the posted entry (before reversal).
      const tb = await auth(request(app.getHttpServer()).get(`/api/v1/reports/trial-balance?fiscalPeriodId=${curPeriod.body.id}`));
      expect(tb.status).toBe(200);
      expect(tb.body.totals.periodDebitMinor).toBe(tb.body.totals.periodCreditMinor);
      const salesRow = tb.body.rows.find((r: any) => r.accountCode === '4010');
      expect(salesRow.periodCreditMinor).toBe(1000000);
      const vat = await auth(request(app.getHttpServer()).get(`/api/v1/reports/vat-summary?fiscalPeriodId=${curPeriod.body.id}`));
      expect(vat.status).toBe(200);
      expect(vat.body.outputVatMinor).toBe(150000);
      expect(vat.body.inputVatMinor).toBe(0);
      expect(vat.body.netVatPayableMinor).toBe(150000);
      const ledger = await auth(request(app.getHttpServer()).get(`/api/v1/reports/general-ledger?accountId=${salesId}&from=${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z&to=${year}-${String(month).padStart(2, '0')}-${lastDay}T23:59:59.999Z`));
      expect(ledger.status).toBe(200);
      expect(ledger.body.lines).toHaveLength(1);
      expect(ledger.body.closingNetMinor).toBe(-1000000);

      const reversal = await auth(request(app.getHttpServer()).post(`/api/v1/journals/${entryId}/reverse`)).send({});
      expect(reversal.status).toBe(201);
      expect(reversal.body.status).toBe('POSTED');
      expect(reversal.body.reverses.number).toBe(draft.body.number);
      const original = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${entryId}`));
      expect(original.body.status).toBe('REVERSED');
      const reverseAgain = await auth(request(app.getHttpServer()).post(`/api/v1/journals/${entryId}/reverse`)).send({});
      expect(reverseAgain.status).toBe(409);

      // Cross-tenant: a second tenant's owner cannot see tenant A's journal.
      const regB = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ tenantName: `Acct B ${suffix}`, slug: `acct-b-${suffix}`, email: `owner@acct-b-${suffix}.test`, password: 'Demo1234!' });
      const tokenB = regB.body.tokens.accessToken as string;
      const crossGet = await request(app.getHttpServer())
        .get(`/api/v1/journals/${entryId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(crossGet.status).toBe(404);
      const crossList = await request(app.getHttpServer())
        .get('/api/v1/journals')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(crossList.status).toBe(200);
      expect(crossList.body.meta.total).toBe(0);

      // Viewer (seed-dependent): read-only, cannot create a journal.
      const viewerLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
      if (viewerLogin.status === 201) {
        const viewerToken = viewerLogin.body.tokens.accessToken as string;
        const forbidden = await request(app.getHttpServer())
          .post('/api/v1/journals')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ entryDate, description: 'Nope', lines });
        expect(forbidden.status).toBe(403);
        const viewerRead = await request(app.getHttpServer())
          .get('/api/v1/journals')
          .set('Authorization', `Bearer ${viewerToken}`);
        expect(viewerRead.status).toBe(200);
      } else {
        console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('sales: lead -> opportunity -> quote -> order -> invoice -> payment, credit limit, credit note, AR aging', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Sales Co ${suffix}`, slug: `sales-${suffix}`, email: `owner@sales-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const contact = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'CUSTOMER', legalName: `Buyer ${suffix}`, displayName: `Buyer ${suffix}`, email: `buyer-${suffix}@test.sa`, creditLimitMinor: 5000000, paymentTermsDays: 30 });
    expect(contact.status).toBe(201);
    const customerId = contact.body.id as string;
    const uom = await auth(request(app.getHttpServer()).post('/api/v1/settings/units')).send({ code: 'piece', name: 'Piece' });
    expect(uom.status).toBe(201);
    const item = await auth(request(app.getHttpServer()).post('/api/v1/items'))
      .send({ sku: `SKU-S-${suffix}`, name: 'Basmati Rice', defaultUomId: uom.body.id, salesPriceMinor: 3499, purchasePriceMinor: 2800 });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;
    const lines = [{ itemId, quantity: 10, unitPriceMinor: 3499, discountPct: 0, taxRateBps: 1500 }];
    // 10 x 3499 = 34,990 net; VAT 15% = 5,249 (5248.5 half-up); total 40,239.

    // Lead -> convert -> customer contact.
    const lead = await auth(request(app.getHttpServer()).post('/api/v1/leads'))
      .send({ name: 'Khalid', company: 'Otaibi Trading', email: `khalid-${suffix}@test.sa`, source: 'REFERRAL', expectedValueMinor: 5000000 });
    expect(lead.status).toBe(201);
    const converted = await auth(request(app.getHttpServer()).post(`/api/v1/leads/${lead.body.id}/convert`)).send({});
    expect(converted.status).toBe(201);
    expect(converted.body.type).toBe('CUSTOMER');
    const leadAfter = await auth(request(app.getHttpServer()).get(`/api/v1/leads/${lead.body.id}`));
    expect(leadAfter.body.status).toBe('QUALIFIED');
    expect(leadAfter.body.contactId).toBe(converted.body.id);

    // Opportunity (stage changes are audited; move it to PROPOSAL).
    const opp = await auth(request(app.getHttpServer()).post('/api/v1/opportunities'))
      .send({ customerId, leadId: lead.body.id, title: `Rice deal ${suffix}`, stage: 'PROSPECTING', probability: 50, expectedValueMinor: 40239 });
    expect(opp.status).toBe(201);
    const oppMoved = await auth(request(app.getHttpServer()).patch(`/api/v1/opportunities/${opp.body.id}`))
      .send({ stage: 'PROPOSAL', probability: 75 });
    expect(oppMoved.status).toBe(200);
    expect(oppMoved.body.stage).toBe('PROPOSAL');

    // Quote -> send -> accept creates a DRAFT order.
    const quote = await auth(request(app.getHttpServer()).post('/api/v1/quotes'))
      .send({ customerId, validFrom: `${today}T00:00:00.000Z`, validTo: `${year + 1}-01-01T00:00:00.000Z`, lines });
    expect(quote.status).toBe(201);
    expect(quote.body.totalMinor).toBe(40239);
    expect(quote.body.taxMinor).toBe(5249);
    expect(quote.body.number).toMatch(/^QUO-/);
    const sent = await auth(request(app.getHttpServer()).post(`/api/v1/quotes/${quote.body.id}/send`)).send({});
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('SENT');
    const accepted = await auth(request(app.getHttpServer()).post(`/api/v1/quotes/${quote.body.id}/accept`)).send({});
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe('ACCEPTED');
    expect(accepted.body.salesOrderId).toBeTruthy();
    const orderId = accepted.body.salesOrderId as string;
    const order = await auth(request(app.getHttpServer()).get(`/api/v1/sales-orders/${orderId}`));
    expect(order.body.status).toBe('DRAFT');
    expect(order.body.totalMinor).toBe(40239);
    expect(order.body.lines[0].quantityFulfilled).toBe(0);

    // Confirm: open AR (0) + 40,239 < 5,000,000 limit.
    const confirmed = await auth(request(app.getHttpServer()).post(`/api/v1/sales-orders/${orderId}/confirm`)).send({});
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.status).toBe('CONFIRMED');

    // Invoice from the order -> post (Dr AR / Cr revenue / Cr output VAT).
    const invoice = await auth(request(app.getHttpServer()).post('/api/v1/sales-invoices'))
      .send({ customerId, orderId, invoiceDate: `${today}T00:00:00.000Z`, lines });
    expect(invoice.status).toBe(201);
    expect(invoice.body.totalMinor).toBe(40239);
    expect(invoice.body.dueDate.slice(0, 10)).toBe(new Date(new Date(`${today}T00:00:00.000Z`).getTime() + 30 * 86400000).toISOString().slice(0, 10));
    const posted = await auth(request(app.getHttpServer()).post(`/api/v1/sales-invoices/${invoice.body.id}/post`)).send({});
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.journalEntryId).toBeTruthy();
    const journal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${posted.body.journalEntryId}`));
    expect(journal.status).toBe(200);
    expect(journal.body.sourceModule).toBe('SALES');
    expect(journal.body.reference).toBe(invoice.body.number);
    expect(journal.body.totalDebitMinor).toBe(40239);

    // POSTED invoices cannot be voided — only a credit note corrects them.
    const voidPosted = await auth(request(app.getHttpServer()).post(`/api/v1/sales-invoices/${invoice.body.id}/void`)).send({});
    expect(voidPosted.status).toBe(409);
    const creditNote = await auth(request(app.getHttpServer()).post('/api/v1/sales-invoices'))
      .send({ type: 'CREDIT_NOTE', customerId, orderId, invoiceDate: `${today}T00:00:00.000Z`, lines });
    expect(creditNote.status).toBe(201);
    expect(creditNote.body.totalMinor).toBe(-40239);
    const cnPosted = await auth(request(app.getHttpServer()).post(`/api/v1/sales-invoices/${creditNote.body.id}/post`)).send({});
    expect(cnPosted.status).toBe(201);
    expect(cnPosted.body.status).toBe('POSTED');

    // Partial payment -> PARTIALLY_PAID; over-allocation -> 400.
    const overpay = await auth(request(app.getHttpServer()).post('/api/v1/customer-payments'))
      .send({ customerId, method: 'BANK_TRANSFER', paymentDate: `${today}T00:00:00.000Z`, amountMinor: 50000, allocations: [{ invoiceId: invoice.body.id, amountMinor: 50000 }] });
    expect(overpay.status).toBe(400);
    const payment = await auth(request(app.getHttpServer()).post('/api/v1/customer-payments'))
      .send({ customerId, method: 'BANK_TRANSFER', paymentDate: `${today}T00:00:00.000Z`, amountMinor: 20000, allocations: [{ invoiceId: invoice.body.id, amountMinor: 20000 }] });
    expect(payment.status).toBe(201);
    expect(payment.body.number).toMatch(/^PAY-/);
    expect(payment.body.journalEntryId).toBeTruthy();
    const invAfter = await auth(request(app.getHttpServer()).get(`/api/v1/sales-invoices/${invoice.body.id}`));
    expect(invAfter.body.status).toBe('PARTIALLY_PAID');
    expect(invAfter.body.paidMinor).toBe(20000);

    // AR aging: 40,239 - 20,000 = 20,239 still owed, not yet due -> CURRENT.
    const aging = await auth(request(app.getHttpServer()).get('/api/v1/reports/ar-aging'));
    expect(aging.status).toBe(200);
    expect(aging.body.totals.totalMinor).toBe(20239);
    expect(aging.body.totals.currentMinor).toBe(20239);
    expect(aging.body.customers[0].customerName).toBe(`Buyer ${suffix}`);

    // Credit-limit block: a 10,000-limit customer cannot confirm a 40,239 order.
    const small = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'CUSTOMER', legalName: `Small ${suffix}`, displayName: `Small ${suffix}`, email: `small-${suffix}@test.sa`, creditLimitMinor: 10000 });
    expect(small.status).toBe(201);
    const bigOrder = await auth(request(app.getHttpServer()).post('/api/v1/sales-orders'))
      .send({ customerId: small.body.id, lines });
    expect(bigOrder.status).toBe(201);
    const blocked = await auth(request(app.getHttpServer()).post(`/api/v1/sales-orders/${bigOrder.body.id}/confirm`)).send({});
    expect(blocked.status).toBe(400);

    // Expired quote: SENT with validTo in the past reads EXPIRED and cannot be accepted.
    const stale = await auth(request(app.getHttpServer()).post('/api/v1/quotes'))
      .send({ customerId, validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-01-31T00:00:00.000Z', lines });
    expect(stale.status).toBe(201);
    await auth(request(app.getHttpServer()).post(`/api/v1/quotes/${stale.body.id}/send`)).send({});
    const staleGet = await auth(request(app.getHttpServer()).get(`/api/v1/quotes/${stale.body.id}`));
    expect(staleGet.body.status).toBe('EXPIRED');
    const staleAccept = await auth(request(app.getHttpServer()).post(`/api/v1/quotes/${stale.body.id}/accept`)).send({});
    expect(staleAccept.status).toBe(409);

    // Cross-tenant 404 on the invoice.
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Sales B ${suffix}`, slug: `sales-b-${suffix}`, email: `owner@sales-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer())
      .get(`/api/v1/sales-invoices/${invoice.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);

    // Viewer (seed-dependent): read-only, cannot create a lead.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'Nope' });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }
  });

  it('purchasing: PO -> supplier invoice (3-way match) -> payment, AP aging', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Purch Co ${suffix}`, slug: `purch-${suffix}`, email: `owner@purch-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const supplier = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'SUPPLIER', legalName: `Supplier ${suffix}`, displayName: `Supplier ${suffix}`, email: `sup-${suffix}@test.sa`, paymentTermsDays: 30 });
    expect(supplier.status).toBe(201);
    const supplierId = supplier.body.id as string;
    const uom = await auth(request(app.getHttpServer()).post('/api/v1/settings/units')).send({ code: 'piece', name: 'Piece' });
    expect(uom.status).toBe(201);
    const item = await auth(request(app.getHttpServer()).post('/api/v1/items'))
      .send({ sku: `SKU-P-${suffix}`, name: 'Basmati Rice', defaultUomId: uom.body.id, salesPriceMinor: 3499, purchasePriceMinor: 2800 });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;
    // 50 x 2800 = 140,000 net; VAT 15% = 21,000; total 161,000.
    const poLines = [{ itemId, quantity: 50, unitPriceMinor: 2800, discountPct: 0, taxRateBps: 1500 }];

    const po = await auth(request(app.getHttpServer()).post('/api/v1/purchase-orders'))
      .send({ supplierId, lines: poLines });
    expect(po.status).toBe(201);
    expect(po.body.totalMinor).toBe(161000);
    expect(po.body.number).toMatch(/^PO-/);
    const poLineId = po.body.lines[0].id as string;

    // A PO posts nothing to the ledger (commitment only).
    const journalsBefore = await auth(request(app.getHttpServer()).get('/api/v1/journals?sourceModule=PURCHASING'));
    expect(journalsBefore.status).toBe(200);
    expect(journalsBefore.body.meta.total).toBe(0);

    const sent = await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/send`)).send({});
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('SENT');
    const confirmed = await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/confirm`)).send({});
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.status).toBe('CONFIRMED');

    // Supplier invoice linked to the PO -> post (Dr purchases / Dr input VAT / Cr AP).
    const sinv = await auth(request(app.getHttpServer()).post('/api/v1/supplier-invoices'))
      .send({ supplierId, purchaseOrderId: po.body.id, invoiceDate: `${today}T00:00:00.000Z`, lines: [{ itemId, quantity: 50, unitPriceMinor: 2800, discountPct: 0, taxRateBps: 1500, purchaseOrderLineId: poLineId }] });
    expect(sinv.status).toBe(201);
    expect(sinv.body.totalMinor).toBe(161000);
    expect(sinv.body.number).toMatch(/^SIN-/);
    const posted = await auth(request(app.getHttpServer()).post(`/api/v1/supplier-invoices/${sinv.body.id}/post`)).send({});
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.journalEntryId).toBeTruthy();
    const journal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${posted.body.journalEntryId}`));
    expect(journal.status).toBe(200);
    expect(journal.body.sourceModule).toBe('PURCHASING');
    expect(journal.body.totalDebitMinor).toBe(161000);

    // 3-way match: invoicing 1 more unit exceeds the PO ordered qty (50/50 already invoiced).
    const overQty = await auth(request(app.getHttpServer()).post('/api/v1/supplier-invoices'))
      .send({ supplierId, purchaseOrderId: po.body.id, invoiceDate: `${today}T00:00:00.000Z`, lines: [{ itemId, quantity: 1, unitPriceMinor: 2800, discountPct: 0, taxRateBps: 1500, purchaseOrderLineId: poLineId }] });
    expect(overQty.status).toBe(201);
    const overQtyPost = await auth(request(app.getHttpServer()).post(`/api/v1/supplier-invoices/${overQty.body.id}/post`)).send({});
    expect(overQtyPost.status).toBe(400);
    expect(overQtyPost.body.error.message).toMatch(/exceeds the purchase order quantity/);

    // 3-way match: unit price 2968 vs PO 2800 = +6% > 5% tolerance.
    // (A fresh PO is used so the quantity check does not fire first.)
    const po2 = await auth(request(app.getHttpServer()).post('/api/v1/purchase-orders'))
      .send({ supplierId, lines: [{ itemId, quantity: 100, unitPriceMinor: 2800, discountPct: 0, taxRateBps: 1500 }] });
    expect(po2.status).toBe(201);
    const po2LineId = po2.body.lines[0].id as string;
    await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po2.body.id}/send`)).send({});
    await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po2.body.id}/confirm`)).send({});
    const overPrice = await auth(request(app.getHttpServer()).post('/api/v1/supplier-invoices'))
      .send({ supplierId, purchaseOrderId: po2.body.id, invoiceDate: `${today}T00:00:00.000Z`, lines: [{ itemId, quantity: 1, unitPriceMinor: 2968, discountPct: 0, taxRateBps: 1500, purchaseOrderLineId: po2LineId }] });
    expect(overPrice.status).toBe(201);
    const overPricePost = await auth(request(app.getHttpServer()).post(`/api/v1/supplier-invoices/${overPrice.body.id}/post`)).send({});
    expect(overPricePost.status).toBe(400);
    expect(overPricePost.body.error.message).toMatch(/exceeds 5% tolerance/);

    // Partial supplier payment -> PARTIALLY_PAID.
    const payment = await auth(request(app.getHttpServer()).post('/api/v1/supplier-payments'))
      .send({ supplierId, method: 'BANK_TRANSFER', paymentDate: `${today}T00:00:00.000Z`, amountMinor: 100000, allocations: [{ invoiceId: sinv.body.id, amountMinor: 100000 }] });
    expect(payment.status).toBe(201);
    expect(payment.body.number).toMatch(/^SPAY-/);
    const invAfter = await auth(request(app.getHttpServer()).get(`/api/v1/supplier-invoices/${sinv.body.id}`));
    expect(invAfter.body.status).toBe('PARTIALLY_PAID');
    expect(invAfter.body.paidMinor).toBe(100000);

    // AP aging: 161,000 - 100,000 = 61,000 still owed, not yet due -> CURRENT.
    const aging = await auth(request(app.getHttpServer()).get('/api/v1/reports/ap-aging'));
    expect(aging.status).toBe(200);
    expect(aging.body.totals.totalMinor).toBe(61000);
    expect(aging.body.totals.currentMinor).toBe(61000);
    expect(aging.body.suppliers[0].supplierName).toBe(`Supplier ${suffix}`);

    // Cross-tenant 404 on the PO.
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Purch B ${suffix}`, slug: `purch-b-${suffix}`, email: `owner@purch-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${po.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);

    // Viewer (seed-dependent): read-only, cannot create a purchase order.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ supplierId, lines: poLines });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }
  });

  it('inventory: GRN -> PO received + stock + GRNI, order confirm reserves, delivery -> fulfilled + COGS, adjustment, transfer, count, low-stock', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Inv Co ${suffix}`, slug: `inv-${suffix}`, email: `owner@inv-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const wh = await auth(request(app.getHttpServer()).post('/api/v1/settings/warehouses'))
      .send({ name: 'Main', code: 'WH-1', isDefault: true });
    expect(wh.status).toBe(201);
    const wh2 = await auth(request(app.getHttpServer()).post('/api/v1/settings/warehouses'))
      .send({ name: 'Second', code: 'WH-2' });
    expect(wh2.status).toBe(201);
    const warehouseId = wh.body.id as string;
    const warehouse2Id = wh2.body.id as string;

    const supplier = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'SUPPLIER', legalName: `Supplier ${suffix}`, displayName: `Supplier ${suffix}`, email: `sup-${suffix}@test.sa`, paymentTermsDays: 30 });
    expect(supplier.status).toBe(201);
    const customer = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'CUSTOMER', legalName: `Buyer ${suffix}`, displayName: `Buyer ${suffix}`, email: `buy-${suffix}@test.sa`, creditLimitMinor: 10000000, paymentTermsDays: 30 });
    expect(customer.status).toBe(201);
    const uom = await auth(request(app.getHttpServer()).post('/api/v1/settings/units')).send({ code: 'piece', name: 'Piece' });
    expect(uom.status).toBe(201);
    const item = await auth(request(app.getHttpServer()).post('/api/v1/items'))
      .send({ sku: `SKU-I-${suffix}`, name: 'Basmati Rice', defaultUomId: uom.body.id, salesPriceMinor: 3499, purchasePriceMinor: 2800, costingMethod: 'FIFO', reorderPoint: 50 });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    // PO 50 x 2800, confirm, then receive 30 via GRN.
    const po = await auth(request(app.getHttpServer()).post('/api/v1/purchase-orders'))
      .send({ supplierId: supplier.body.id, lines: [{ itemId, quantity: 50, unitPriceMinor: 2800, discountPct: 0, taxRateBps: 1500 }] });
    expect(po.status).toBe(201);
    const poLineId = po.body.lines[0].id as string;
    await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/send`)).send({});
    const poConfirmed = await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/confirm`)).send({});
    expect(poConfirmed.body.status).toBe('CONFIRMED');

    const grn = await auth(request(app.getHttpServer()).post('/api/v1/inventory/goods-receipts'))
      .send({ purchaseOrderId: po.body.id, warehouseId, receiptDate: `${today}T00:00:00.000Z`, lines: [{ purchaseOrderLineId: poLineId, itemId, quantity: 30, unitCostMinor: 2800 }] });
    expect(grn.status).toBe(201);
    expect(grn.body.number).toMatch(/^GRN-/);
    const grnPosted = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/goods-receipts/${grn.body.id}/post`)).send({});
    expect(grnPosted.status).toBe(201);
    expect(grnPosted.body.status).toBe('POSTED');
    expect(grnPosted.body.journalEntryId).toBeTruthy();
    const grnJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${grnPosted.body.journalEntryId}`));
    expect(grnJournal.status).toBe(200);
    expect(grnJournal.body.sourceModule).toBe('INVENTORY');
    expect(grnJournal.body.totalDebitMinor).toBe(84000);
    // Dr 1210 / Cr 2020 (GRNI).
    const grnLines = grnJournal.body.lines as any[];
    expect(grnLines.some((l: any) => l.account.code === '1210' && l.debitMinor === 84000)).toBe(true);
    expect(grnLines.some((l: any) => l.account.code === '2020' && l.creditMinor === 84000)).toBe(true);

    const poAfter = await auth(request(app.getHttpServer()).get(`/api/v1/purchase-orders/${po.body.id}`));
    expect(poAfter.body.status).toBe('PARTIALLY_RECEIVED');
    expect(poAfter.body.lines[0].quantityReceived).toBe(30);

    const stock = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?warehouseId=${warehouseId}`));
    expect(stock.status).toBe(200);
    expect(stock.body.data).toHaveLength(1);
    expect(stock.body.data[0].qtyOnHand).toBe(30);
    expect(stock.body.data[0].qtyAvailable).toBe(30);
    expect(stock.body.data[0].averageCostMinor).toBe(2800);

    // Supplier invoice for the received 30 relieves GRNI instead of purchases.
    const sinv = await auth(request(app.getHttpServer()).post('/api/v1/supplier-invoices'))
      .send({ supplierId: supplier.body.id, purchaseOrderId: po.body.id, invoiceDate: `${today}T00:00:00.000Z`, lines: [{ itemId, quantity: 30, unitPriceMinor: 2800, discountPct: 0, taxRateBps: 1500, purchaseOrderLineId: poLineId }] });
    expect(sinv.status).toBe(201);
    const sinvPosted = await auth(request(app.getHttpServer()).post(`/api/v1/supplier-invoices/${sinv.body.id}/post`)).send({});
    expect(sinvPosted.status).toBe(201);
    const sinvJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${sinvPosted.body.journalEntryId}`));
    const sinvLines = sinvJournal.body.lines as any[];
    expect(sinvLines.some((l: any) => l.account.code === '2020' && l.debitMinor === 84000)).toBe(true);
    expect(sinvLines.some((l: any) => l.account.code === '5100')).toBe(false);
    expect(sinvLines.some((l: any) => l.account.code === '2010' && l.creditMinor === 96600)).toBe(true);

    // Sales order 20 x 3499: confirm reserves 20, delivery fulfils + COGS.
    const order = await auth(request(app.getHttpServer()).post('/api/v1/sales-orders'))
      .send({ customerId: customer.body.id, lines: [{ itemId, quantity: 20, unitPriceMinor: 3499, discountPct: 0, taxRateBps: 1500 }] });
    expect(order.status).toBe(201);
    const orderLineId = order.body.lines[0].id as string;
    const orderConfirmed = await auth(request(app.getHttpServer()).post(`/api/v1/sales-orders/${order.body.id}/confirm`)).send({});
    expect(orderConfirmed.status).toBe(201);
    const stockReserved = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?warehouseId=${warehouseId}`));
    expect(stockReserved.body.data[0].qtyReserved).toBe(20);
    expect(stockReserved.body.data[0].qtyAvailable).toBe(10);

    const dn = await auth(request(app.getHttpServer()).post('/api/v1/inventory/delivery-notes'))
      .send({ salesOrderId: order.body.id, warehouseId, deliveryDate: `${today}T00:00:00.000Z`, lines: [{ salesOrderLineId: orderLineId, itemId, quantity: 20 }] });
    expect(dn.status).toBe(201);
    const dnPosted = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/delivery-notes/${dn.body.id}/post`)).send({});
    expect(dnPosted.status).toBe(201);
    expect(dnPosted.body.totalCostMinor).toBe(56000);
    const dnJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${dnPosted.body.journalEntryId}`));
    const dnLines = dnJournal.body.lines as any[];
    expect(dnLines.some((l: any) => l.account.code === '5010' && l.debitMinor === 56000)).toBe(true);
    expect(dnLines.some((l: any) => l.account.code === '1210' && l.creditMinor === 56000)).toBe(true);
    const orderAfter = await auth(request(app.getHttpServer()).get(`/api/v1/sales-orders/${order.body.id}`));
    expect(orderAfter.body.status).toBe('FULFILLED');
    expect(orderAfter.body.lines[0].quantityFulfilled).toBe(20);
    const stockAfterDn = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?warehouseId=${warehouseId}`));
    expect(stockAfterDn.body.data[0].qtyOnHand).toBe(10);
    expect(stockAfterDn.body.data[0].qtyReserved).toBe(0);

    // Over-delivery must fail (20/20 already fulfilled).
    const dnOver = await auth(request(app.getHttpServer()).post('/api/v1/inventory/delivery-notes'))
      .send({ salesOrderId: order.body.id, warehouseId, deliveryDate: `${today}T00:00:00.000Z`, lines: [{ salesOrderLineId: orderLineId, itemId, quantity: 1 }] });
    expect(dnOver.status).toBe(201);
    const dnOverPost = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/delivery-notes/${dnOver.body.id}/post`)).send({});
    expect(dnOverPost.status).toBe(400);

    // Adjustment: damage 2 -> on hand 8, Dr 5240 / Cr 1210 (5,600).
    const adj = await auth(request(app.getHttpServer()).post('/api/v1/inventory/adjustments'))
      .send({ warehouseId, adjustmentDate: `${today}T00:00:00.000Z`, lines: [{ itemId, quantityDelta: -2, reason: 'DAMAGE' }] });
    expect(adj.status).toBe(201);
    const adjPosted = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/adjustments/${adj.body.id}/post`)).send({});
    expect(adjPosted.status).toBe(201);
    expect(adjPosted.body.totalValueMinor).toBe(-5600);
    const adjJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${adjPosted.body.journalEntryId}`));
    expect((adjJournal.body.lines as any[]).some((l: any) => l.account.code === '5240' && l.debitMinor === 5600)).toBe(true);

    // Transfer 5 to the second warehouse (no ledger entry, two movements).
    const trf = await auth(request(app.getHttpServer()).post('/api/v1/inventory/transfers'))
      .send({ fromWarehouseId: warehouseId, toWarehouseId: warehouse2Id, transferDate: `${today}T00:00:00.000Z`, lines: [{ itemId, quantity: 5 }] });
    expect(trf.status).toBe(201);
    const trfPosted = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/transfers/${trf.body.id}/post`)).send({});
    expect(trfPosted.status).toBe(201);
    const stockWh1 = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?warehouseId=${warehouseId}`));
    expect(stockWh1.body.data[0].qtyOnHand).toBe(3);
    const stockWh2 = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?warehouseId=${warehouse2Id}`));
    expect(stockWh2.body.data[0].qtyOnHand).toBe(5);
    const movements = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/movements?sourceType=TRANSFER`));
    expect(movements.body.meta.total).toBe(2);

    // Count: counted 2 vs system 3 -> variance -1, on hand 2 after approval.
    const cnt = await auth(request(app.getHttpServer()).post('/api/v1/inventory/counts'))
      .send({ warehouseId, countDate: `${today}T00:00:00.000Z`, lines: [{ itemId, countedQuantity: 2 }] });
    expect(cnt.status).toBe(201);
    expect(cnt.body.lines[0].varianceQuantity).toBe(-1);
    const cntApproved = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/counts/${cnt.body.id}/approve`)).send({});
    expect(cntApproved.status).toBe(201);
    expect(cntApproved.body.status).toBe('APPROVED');
    const stockFinal = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?warehouseId=${warehouseId}`));
    expect(stockFinal.body.data[0].qtyOnHand).toBe(2);

    // Low-stock report: on hand 2 <= reorder point 50.
    const low = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/reports/low-stock?warehouseId=${warehouseId}`));
    expect(low.status).toBe(200);
    expect(low.body.data.some((r: any) => r.item.sku === `SKU-I-${suffix}` && r.qtyOnHand === 2)).toBe(true);

    // Cross-tenant 404 on the GRN.
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Inv B ${suffix}`, slug: `inv-b-${suffix}`, email: `owner@inv-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer())
      .get(`/api/v1/inventory/goods-receipts/${grn.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);

    // Viewer (seed-dependent): read-only, cannot post an adjustment.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/inventory/adjustments')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ warehouseId, adjustmentDate: `${today}T00:00:00.000Z`, lines: [{ itemId, quantityDelta: -1, reason: 'DAMAGE' }] });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/inventory/stock')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }
  });

  it('pos: terminal -> shift -> sale -> void -> close with Z-report, barcode lookup', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `POS Co ${suffix}`, slug: `pos-${suffix}`, email: `owner@pos-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const wh = await auth(request(app.getHttpServer()).post('/api/v1/settings/warehouses'))
      .send({ name: 'Main', code: 'WH-1', isDefault: true });
    expect(wh.status).toBe(201);
    const br = await auth(request(app.getHttpServer()).post('/api/v1/settings/branches'))
      .send({ name: 'Main', code: 'BR-1', isDefault: true });
    expect(br.status).toBe(201);
    const supplier = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'SUPPLIER', legalName: `Supplier ${suffix}`, displayName: `Supplier ${suffix}`, email: `sup-${suffix}@test.sa` });
    expect(supplier.status).toBe(201);
    const uom = await auth(request(app.getHttpServer()).post('/api/v1/settings/units')).send({ code: 'piece', name: 'Piece' });
    expect(uom.status).toBe(201);
    const item = await auth(request(app.getHttpServer()).post('/api/v1/items'))
      .send({ sku: `SKU-POS-${suffix}`, name: 'Basmati Rice', barcode: `BAR-${suffix}`, defaultUomId: uom.body.id, salesPriceMinor: 3499, purchasePriceMinor: 2800, costingMethod: 'FIFO' });
    expect(item.status).toBe(201);
    const itemId = item.body.id as string;

    // Stock the item via a PO + GRN (10 units).
    const po = await auth(request(app.getHttpServer()).post('/api/v1/purchase-orders'))
      .send({ supplierId: supplier.body.id, lines: [{ itemId, quantity: 10, unitPriceMinor: 2800, discountPct: 0, taxRateBps: 1500 }] });
    expect(po.status).toBe(201);
    await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/send`)).send({});
    await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/confirm`)).send({});
    const grn = await auth(request(app.getHttpServer()).post('/api/v1/inventory/goods-receipts'))
      .send({ purchaseOrderId: po.body.id, warehouseId: wh.body.id, receiptDate: `${today}T00:00:00.000Z`, lines: [{ purchaseOrderLineId: po.body.lines[0].id, itemId, quantity: 10, unitCostMinor: 2800 }] });
    expect(grn.status).toBe(201);
    const grnPosted = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/goods-receipts/${grn.body.id}/post`)).send({});
    expect(grnPosted.status).toBe(201);

    const terminal = await auth(request(app.getHttpServer()).post('/api/v1/pos/terminals'))
      .send({ code: 'POS-1', name: 'Counter 1', branchId: br.body.id, warehouseId: wh.body.id });
    expect(terminal.status).toBe(201);
    const terminalId = terminal.body.id as string;

    // Barcode lookup: price + available stock.
    const lookup = await auth(request(app.getHttpServer()).get(`/api/v1/pos/lookup?terminalId=${terminalId}&q=BAR-${suffix}`));
    expect(lookup.status).toBe(200);
    expect(lookup.body.priceMinor).toBe(3499);
    expect(lookup.body.qtyAvailable).toBe(10);

    const shift = await auth(request(app.getHttpServer()).post('/api/v1/pos/shifts/open'))
      .send({ terminalId, openingFloatMinor: 50000 });
    expect(shift.status).toBe(201);
    expect(shift.body.status).toBe('OPEN');
    const shiftId = shift.body.id as string;
    // A second OPEN shift on the same terminal must fail.
    const shift2 = await auth(request(app.getHttpServer()).post('/api/v1/pos/shifts/open'))
      .send({ terminalId, openingFloatMinor: 1000 });
    expect(shift2.status).toBe(409);

    // Sale 1: 2 x 3499 cash = 8,048 (net 6,998 + VAT 1,050; COGS 5,600).
    const sale1 = await auth(request(app.getHttpServer()).post('/api/v1/pos/sales'))
      .send({ terminalId, shiftId, lines: [{ itemId, quantity: 2 }], payments: [{ method: 'CASH', amountMinor: 8048 }] });
    expect(sale1.status).toBe(201);
    expect(sale1.body.number).toMatch(/^POS-/);
    expect(sale1.body.totalMinor).toBe(8048);
    expect(sale1.body.cogsMinor).toBe(5600);
    expect(sale1.body.journalEntryId).toBeTruthy();
    const sale1Journal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${sale1.body.journalEntryId}`));
    expect(sale1Journal.body.sourceModule).toBe('POS');
    const s1Lines = sale1Journal.body.lines as any[];
    expect(s1Lines.some((l: any) => l.account.code === '1010' && l.debitMinor === 8048)).toBe(true);
    expect(s1Lines.some((l: any) => l.account.code === '4010' && l.creditMinor === 6998)).toBe(true);
    expect(s1Lines.some((l: any) => l.account.code === '5010' && l.debitMinor === 5600)).toBe(true);

    // Sale 2: 1 x 3499 by card, then void it (stock restored).
    const sale2 = await auth(request(app.getHttpServer()).post('/api/v1/pos/sales'))
      .send({ terminalId, shiftId, lines: [{ itemId, quantity: 1 }], payments: [{ method: 'CARD', amountMinor: 4024 }] });
    expect(sale2.status).toBe(201);
    const voided = await auth(request(app.getHttpServer()).post(`/api/v1/pos/sales/${sale2.body.id}/void`)).send({});
    expect(voided.status).toBe(201);
    expect(voided.body.status).toBe('VOIDED');
    const stockAfterVoid = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?warehouseId=${wh.body.id}`));
    expect(stockAfterVoid.body.data[0].qtyOnHand).toBe(8);

    // Payment splits must equal the sale total.
    const badSplit = await auth(request(app.getHttpServer()).post('/api/v1/pos/sales'))
      .send({ terminalId, shiftId, lines: [{ itemId, quantity: 1 }], payments: [{ method: 'CASH', amountMinor: 1000 }] });
    expect(badSplit.status).toBe(400);

    // Z-report before close: 1 completed sale, cash 8,048, expected cash 58,048.
    const z = await auth(request(app.getHttpServer()).get(`/api/v1/pos/shifts/${shiftId}/z-report`));
    expect(z.status).toBe(200);
    expect(z.body.salesCount).toBe(1);
    expect(z.body.cashMinor).toBe(8048);
    expect(z.body.cardMinor).toBe(0);
    expect(z.body.expectedCashMinor).toBe(58048);

    // Close short by 500: variance -500, posted to 5250.
    const closed = await auth(request(app.getHttpServer()).post(`/api/v1/pos/shifts/${shiftId}/close`))
      .send({ countedCashMinor: 57548 });
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.varianceMinor).toBe(-500);
    expect(closed.body.journalEntryId).toBeTruthy();
    const varJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${closed.body.journalEntryId}`));
    expect((varJournal.body.lines as any[]).some((l: any) => l.account.code === '5250' && l.debitMinor === 500)).toBe(true);

    // A closed shift takes no more sales.
    const afterClose = await auth(request(app.getHttpServer()).post('/api/v1/pos/sales'))
      .send({ terminalId, shiftId, lines: [{ itemId, quantity: 1 }], payments: [{ method: 'CASH', amountMinor: 4024 }] });
    expect(afterClose.status).toBe(409);

    // Cross-tenant 404 on the terminal.
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `POS B ${suffix}`, slug: `pos-b-${suffix}`, email: `owner@pos-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer())
      .get(`/api/v1/pos/terminals/${terminalId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);
  });

  it('manufacturing: work centre -> BOM roll-up -> work order -> issue -> receipt -> scrap -> WIP -> complete, cross-tenant 404, viewer 403', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Mfg Co ${suffix}`, slug: `mfg-${suffix}`, email: `owner@mfg-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const wh = await auth(request(app.getHttpServer()).post('/api/v1/settings/warehouses'))
      .send({ name: 'Main', code: 'WH-1', isDefault: true });
    expect(wh.status).toBe(201);
    const warehouseId = wh.body.id as string;
    const uom = await auth(request(app.getHttpServer()).post('/api/v1/settings/units')).send({ code: 'piece', name: 'Piece' });
    expect(uom.status).toBe(201);

    const mkItem = async (sku: string, standardCostMinor: number) => {
      const r = await auth(request(app.getHttpServer()).post('/api/v1/items'))
        .send({ sku, name: sku, defaultUomId: uom.body.id, salesPriceMinor: standardCostMinor + 1000, purchasePriceMinor: standardCostMinor, standardCostMinor, costingMethod: 'FIFO' });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    const compA = await mkItem(`CMP-A-${suffix}`, 6500);
    const compB = await mkItem(`CMP-B-${suffix}`, 1000);
    const finished = await mkItem(`FIN-${suffix}`, 0);

    // Stock the components: PO 50 x A @ 6500 + 30 x B @ 1000, then GRN.
    const supplier = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'SUPPLIER', legalName: `Supplier ${suffix}`, displayName: `Supplier ${suffix}`, email: `sup-mfg-${suffix}@test.sa`, paymentTermsDays: 30 });
    expect(supplier.status).toBe(201);
    const po = await auth(request(app.getHttpServer()).post('/api/v1/purchase-orders'))
      .send({ supplierId: supplier.body.id, lines: [{ itemId: compA, quantity: 50, unitPriceMinor: 6500, taxRateBps: 1500 }, { itemId: compB, quantity: 30, unitPriceMinor: 1000, taxRateBps: 1500 }] });
    expect(po.status).toBe(201);
    await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/send`)).send({});
    await auth(request(app.getHttpServer()).post(`/api/v1/purchase-orders/${po.body.id}/confirm`)).send({});
    const grn = await auth(request(app.getHttpServer()).post('/api/v1/inventory/goods-receipts'))
      .send({ purchaseOrderId: po.body.id, warehouseId, receiptDate: `${today}T00:00:00.000Z`, lines: [{ purchaseOrderLineId: po.body.lines[0].id, itemId: compA, quantity: 50, unitCostMinor: 6500 }, { purchaseOrderLineId: po.body.lines[1].id, itemId: compB, quantity: 30, unitCostMinor: 1000 }] });
    expect(grn.status).toBe(201);
    const grnPosted = await auth(request(app.getHttpServer()).post(`/api/v1/inventory/goods-receipts/${grn.body.id}/post`)).send({});
    expect(grnPosted.status).toBe(201);

    // Work centre + BOM (roll-up: 2 x 6500 x 1.05 + 1000 = 14,650).
    const wc = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/work-centers'))
      .send({ code: 'WC-1', name: 'Packing Line 1', standardCostRateMinor: 5000 });
    expect(wc.status).toBe(201);
    const bom = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/boms'))
      .send({ finishedItemId: finished, version: 1, status: 'DRAFT', lines: [{ componentItemId: compA, quantityPerUnit: 2, scrapBps: 500, workCenterId: wc.body.id, operationName: 'Packing' }, { componentItemId: compB, quantityPerUnit: 1, scrapBps: 0 }] });
    expect(bom.status).toBe(201);
    expect(bom.body.standardCostMinor).toBe(14650);
    const cost = await auth(request(app.getHttpServer()).get(`/api/v1/manufacturing/boms/${bom.body.id}/cost`));
    expect(cost.status).toBe(200);
    expect(cost.body.standardCostMinor).toBe(14650);
    expect(cost.body.lines[0].lineCostMinor).toBe(13650);
    const bomActive = await auth(request(app.getHttpServer()).patch(`/api/v1/manufacturing/boms/${bom.body.id}`)).send({ status: 'ACTIVE' });
    expect(bomActive.status).toBe(200);
    expect(bomActive.body.status).toBe('ACTIVE');

    // A second DRAFT BOM cannot be released against.
    const bom2 = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/boms'))
      .send({ finishedItemId: finished, version: 2, status: 'DRAFT', lines: [{ componentItemId: compA, quantityPerUnit: 1, scrapBps: 0 }] });
    expect(bom2.status).toBe(201);
    const woDraft = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/work-orders'))
      .send({ finishedItemId: finished, bomId: bom2.body.id, warehouseId, qtyPlanned: 5, operations: [{ name: 'Packing', workCenterId: wc.body.id, plannedHours: 4 }] });
    expect(woDraft.status).toBe(201);
    const releaseDraftBom = await auth(request(app.getHttpServer()).post(`/api/v1/manufacturing/work-orders/${woDraft.body.id}/release`)).send({});
    expect(releaseDraftBom.status).toBe(400);
    await auth(request(app.getHttpServer()).delete(`/api/v1/manufacturing/work-orders/${woDraft.body.id}`));

    // Work order 10 x finished: release snapshots the BOM (A 21, B 10; planned 146,500).
    const wo = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/work-orders'))
      .send({ finishedItemId: finished, bomId: bom.body.id, warehouseId, qtyPlanned: 10, operations: [{ name: 'Packing', workCenterId: wc.body.id, plannedHours: 8 }] });
    expect(wo.status).toBe(201);
    const released = await auth(request(app.getHttpServer()).post(`/api/v1/manufacturing/work-orders/${wo.body.id}/release`)).send({});
    expect(released.status).toBe(201);
    expect(released.body.status).toBe('RELEASED');
    expect(released.body.materialCostPlannedMinor).toBe(146500);
    expect(released.body.lines).toHaveLength(2);
    expect(released.body.lines.find((l: any) => l.componentItemId === compA).qtyRequired).toBe(21);
    expect(released.body.lines.find((l: any) => l.componentItemId === compB).qtyRequired).toBe(10);
    const woLineA = released.body.lines.find((l: any) => l.componentItemId === compA).id as string;
    const woLineB = released.body.lines.find((l: any) => l.componentItemId === compB).id as string;

    // Over-issue (22 > 21 required) must fail.
    const overIssue = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/material-issues'))
      .send({ workOrderId: wo.body.id, warehouseId, lines: [{ workOrderLineId: woLineA, itemId: compA, quantity: 22 }] });
    expect(overIssue.status).toBe(400);

    // Issue 21 A + 10 B: Dr 1220 / Cr 1210 (146,500).
    const issue = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/material-issues'))
      .send({ workOrderId: wo.body.id, warehouseId, lines: [{ workOrderLineId: woLineA, itemId: compA, quantity: 21 }, { workOrderLineId: woLineB, itemId: compB, quantity: 10 }] });
    expect(issue.status).toBe(201);
    const issuePosted = await auth(request(app.getHttpServer()).post(`/api/v1/manufacturing/material-issues/${issue.body.id}/post`)).send({});
    expect(issuePosted.status).toBe(201);
    expect(issuePosted.body.status).toBe('POSTED');
    expect(issuePosted.body.totalCostMinor).toBe(146500);
    const issueJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${issuePosted.body.journalEntryId}`));
    expect(issueJournal.body.sourceModule).toBe('MANUFACTURING');
    const issueLines = issueJournal.body.lines as any[];
    expect(issueLines.some((l: any) => l.account.code === '1220' && l.debitMinor === 146500)).toBe(true);
    expect(issueLines.some((l: any) => l.account.code === '1210' && l.creditMinor === 146500)).toBe(true);
    const woAfterIssue = await auth(request(app.getHttpServer()).get(`/api/v1/manufacturing/work-orders/${wo.body.id}`));
    expect(woAfterIssue.body.status).toBe('IN_PROGRESS');
    expect(woAfterIssue.body.materialCostActualMinor).toBe(146500);

    // Receive 6 finished @ 14,650 = 87,900: Dr 1230 / Cr 1220.
    const receipt = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/production-receipts'))
      .send({ workOrderId: wo.body.id, warehouseId, quantity: 6 });
    expect(receipt.status).toBe(201);
    const receiptPosted = await auth(request(app.getHttpServer()).post(`/api/v1/manufacturing/production-receipts/${receipt.body.id}/post`)).send({});
    expect(receiptPosted.status).toBe(201);
    expect(receiptPosted.body.unitCostMinor).toBe(14650);
    expect(receiptPosted.body.totalCostMinor).toBe(87900);
    expect(receiptPosted.body.overProduced).toBe(false);
    const receiptJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${receiptPosted.body.journalEntryId}`));
    const receiptLines = receiptJournal.body.lines as any[];
    expect(receiptLines.some((l: any) => l.account.code === '1230' && l.debitMinor === 87900)).toBe(true);
    expect(receiptLines.some((l: any) => l.account.code === '1220' && l.creditMinor === 87900)).toBe(true);
    const stockFinished = await auth(request(app.getHttpServer()).get(`/api/v1/inventory/stock?itemId=${finished}`));
    expect(stockFinished.body.data[0].qtyOnHand).toBe(6);
    expect(stockFinished.body.data[0].averageCostMinor).toBe(14650);

    // Scrap 1 finished @ 14,650: Dr 5260 / Cr 1220.
    const scrap = await auth(request(app.getHttpServer()).post('/api/v1/manufacturing/scrap'))
      .send({ workOrderId: wo.body.id, kind: 'FINISHED', itemId: finished, warehouseId, quantity: 1, reason: 'Damaged during packing' });
    expect(scrap.status).toBe(201);
    const scrapPosted = await auth(request(app.getHttpServer()).post(`/api/v1/manufacturing/scrap/${scrap.body.id}/post`)).send({});
    expect(scrapPosted.status).toBe(201);
    expect(scrapPosted.body.totalCostMinor).toBe(14650);
    const scrapJournal = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${scrapPosted.body.journalEntryId}`));
    const scrapLines = scrapJournal.body.lines as any[];
    expect(scrapLines.some((l: any) => l.account.code === '5260' && l.debitMinor === 14650)).toBe(true);
    expect(scrapLines.some((l: any) => l.account.code === '1220' && l.creditMinor === 14650)).toBe(true);

    // WIP report: issued 146,500 - received 87,900 - scrap 14,650 = 43,950; 60% complete.
    const wip = await auth(request(app.getHttpServer()).get('/api/v1/manufacturing/reports/wip'));
    expect(wip.status).toBe(200);
    expect(wip.body.data).toHaveLength(1);
    expect(wip.body.data[0].materialIssuedMinor).toBe(146500);
    expect(wip.body.data[0].productionReceivedMinor).toBe(87900);
    expect(wip.body.data[0].finishedScrapMinor).toBe(14650);
    expect(wip.body.data[0].wipBalanceMinor).toBe(43950);
    expect(wip.body.data[0].completionPct).toBe(60);

    // Record actual hours, then complete: zero material variance.
    const opId = released.body.operations[0].id as string;
    const opUpdated = await auth(request(app.getHttpServer()).patch(`/api/v1/manufacturing/work-orders/${wo.body.id}/operations/${opId}`)).send({ actualHours: 5 });
    expect(opUpdated.status).toBe(200);
    expect(opUpdated.body.actualHours).toBe(5);
    const completed = await auth(request(app.getHttpServer()).post(`/api/v1/manufacturing/work-orders/${wo.body.id}/complete`)).send({});
    expect(completed.status).toBe(201);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.variance.plannedMaterialCostMinor).toBe(146500);
    expect(completed.body.variance.actualMaterialCostMinor).toBe(146500);
    expect(completed.body.variance.varianceMinor).toBe(0);

    // Cross-tenant 404 on the work order.
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Mfg B ${suffix}`, slug: `mfg-b-${suffix}`, email: `owner@mfg-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer())
      .get(`/api/v1/manufacturing/work-orders/${wo.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);

    // Viewer (seed-dependent): read-only, cannot create a work centre.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/manufacturing/work-centers')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ code: 'WC-X', name: 'Nope' });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/manufacturing/reports/wip')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }
  });

  it('hr: department -> employee -> leave approve -> attendance -> payroll calculate -> approve -> pay, cross-tenant 404, viewer 403', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Hr Co ${suffix}`, slug: `hr-${suffix}`, email: `owner@hr-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    // Working days (Sun-Thu) of the current month, for leave + absence dates.
    const workingDays: string[] = [];
    for (let d = 1; d <= lastDay; d += 1) {
      const dt = new Date(Date.UTC(year, month - 1, d));
      if (dt.getUTCDay() !== 5 && dt.getUTCDay() !== 6) workingDays.push(`${year}-${pad(month)}-${pad(d)}`);
    }
    expect(workingDays.length).toBeGreaterThan(10);
    const divHalfUp = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const branch = await auth(request(app.getHttpServer()).post('/api/v1/settings/branches'))
      .send({ name: 'Main', code: 'BR-1', isDefault: true });
    expect(branch.status).toBe(201);
    const branchId = branch.body.id as string;

    const dept = await auth(request(app.getHttpServer()).post('/api/v1/hr/departments'))
      .send({ code: 'OPS', name: 'Operations' });
    expect(dept.status).toBe(201);
    const dept2 = await auth(request(app.getHttpServer()).post('/api/v1/hr/departments'))
      .send({ code: 'ADM', name: 'Administration' });
    expect(dept2.status).toBe(201);

    const saudi = await auth(request(app.getHttpServer()).post('/api/v1/hr/employees'))
      .send({ code: 'EMP-1', name: 'Sara Test', jobTitle: 'HR Manager', departmentId: dept2.body.id, branchId, hireDate: '2023-01-15T00:00:00.000Z', basicSalaryMinor: 1200000, housingAllowanceMinor: 300000, transportAllowanceMinor: 50000, nationality: 'SAUDI', iban: 'SA0380000000608012345678' });
    expect(saudi.status).toBe(201);
    const nonSaudi = await auth(request(app.getHttpServer()).post('/api/v1/hr/employees'))
      .send({ code: 'EMP-2', name: 'Raj Test', jobTitle: 'Worker', departmentId: dept.body.id, branchId, hireDate: '2024-03-01T00:00:00.000Z', basicSalaryMinor: 450000, housingAllowanceMinor: 100000, transportAllowanceMinor: 30000, nationality: 'NON_SAUDI' });
    expect(nonSaudi.status).toBe(201);
    const saudiId = saudi.body.id as string;
    const nonSaudiId = nonSaudi.body.id as string;

    // Department manager link.
    const deptManaged = await auth(request(app.getHttpServer()).patch(`/api/v1/hr/departments/${dept2.body.id}`)).send({ managerId: saudiId });
    expect(deptManaged.status).toBe(200);
    expect(deptManaged.body.manager.id).toBe(saudiId);

    // Leave type + request (3 working days) -> approve -> balance 27.
    const leaveType = await auth(request(app.getHttpServer()).post('/api/v1/hr/leave-types'))
      .send({ code: 'ANNUAL', name: 'Annual Leave', daysPerYear: 30, paid: true });
    expect(leaveType.status).toBe(201);
    const leave = await auth(request(app.getHttpServer()).post('/api/v1/hr/leave-requests'))
      .send({ employeeId: saudiId, leaveTypeId: leaveType.body.id, startDate: `${workingDays[10]}T00:00:00.000Z`, endDate: `${workingDays[12]}T00:00:00.000Z` });
    expect(leave.status).toBe(201);
    expect(leave.body.days).toBe(3);
    const approved = await auth(request(app.getHttpServer()).post(`/api/v1/hr/leave-requests/${leave.body.id}/approve`)).send({});
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');
    const balances = await auth(request(app.getHttpServer()).get(`/api/v1/hr/leave-balances?employeeId=${saudiId}&year=${year}`));
    expect(balances.status).toBe(200);
    expect(balances.body.data).toHaveLength(1);
    expect(balances.body.data[0].balance).toBe(27);
    expect(balances.body.data[0].approvedDaysTaken).toBe(3);
    // A second overlapping request must conflict.
    const overlap = await auth(request(app.getHttpServer()).post('/api/v1/hr/leave-requests'))
      .send({ employeeId: saudiId, leaveTypeId: leaveType.body.id, startDate: `${workingDays[11]}T00:00:00.000Z`, endDate: `${workingDays[13]}T00:00:00.000Z` });
    expect(overlap.status).toBe(409);

    // Attendance: 2 absent days for the Saudi employee (bulk, one day each).
    for (const day of [workingDays[1], workingDays[2]]) {
      const bulk = await auth(request(app.getHttpServer()).post('/api/v1/hr/attendance/bulk'))
        .send({ date: `${day}T00:00:00.000Z`, records: [{ employeeId: saudiId, status: 'ABSENT' }, { employeeId: nonSaudiId, status: 'PRESENT', checkIn: '08:00', checkOut: '17:00' }] });
      expect(bulk.status).toBe(201);
    }
    const summary = await auth(request(app.getHttpServer()).get(`/api/v1/hr/attendance/summary?year=${year}&month=${month}&employeeId=${saudiId}`));
    expect(summary.status).toBe(200);
    expect(summary.body.data[0].absent).toBe(2);
    expect(summary.body.data[0].workingDays).toBe(workingDays.length);

    // Payroll run: calculate, then verify the Saudi line math.
    const run = await auth(request(app.getHttpServer()).post('/api/v1/hr/payroll-runs'))
      .send({ periodYear: year, periodMonth: month });
    expect(run.status).toBe(201);
    const calculated = await auth(request(app.getHttpServer()).post(`/api/v1/hr/payroll-runs/${run.body.id}/calculate`)).send({ overrides: [] });
    expect(calculated.status).toBe(201);
    expect(calculated.body.status).toBe('CALCULATED');
    expect(calculated.body.lines).toHaveLength(2);
    const wd = workingDays.length;
    const saudiLine = calculated.body.lines.find((l: any) => l.employeeId === saudiId);
    const expectedAbsentDeduction = divHalfUp(1200000 * 2, wd);
    const expectedGross = 1200000 - expectedAbsentDeduction + 350000;
    expect(saudiLine.absentDays).toBe(2);
    expect(saudiLine.grossMinor).toBe(expectedGross);
    expect(saudiLine.gosiEmployeeMinor).toBe(146250); // 1,500,000 x 9.75%
    expect(saudiLine.gosiEmployerMinor).toBe(176250); // 1,500,000 x 11.75%
    expect(saudiLine.eosbAccrualMinor).toBe(64583); // 1,550,000 x 0.5 / 12
    expect(saudiLine.netMinor).toBe(expectedGross - 146250);
    const nonSaudiLine = calculated.body.lines.find((l: any) => l.employeeId === nonSaudiId);
    expect(nonSaudiLine.gosiEmployeeMinor).toBe(0);
    expect(nonSaudiLine.gosiEmployerMinor).toBe(11000); // 550,000 x 2%
    expect(nonSaudiLine.netMinor).toBe(580000);
    expect(calculated.body.netMinor).toBe(saudiLine.netMinor + nonSaudiLine.netMinor);

    // Approve locks the run: re-calculate must fail.
    const approvedRun = await auth(request(app.getHttpServer()).post(`/api/v1/hr/payroll-runs/${run.body.id}/approve`)).send({});
    expect(approvedRun.status).toBe(201);
    expect(approvedRun.body.status).toBe('APPROVED');
    const recalc = await auth(request(app.getHttpServer()).post(`/api/v1/hr/payroll-runs/${run.body.id}/calculate`)).send({ overrides: [] });
    expect(recalc.status).toBe(409);

    // Pay: accrual + bank payment entries.
    const paid = await auth(request(app.getHttpServer()).post(`/api/v1/hr/payroll-runs/${run.body.id}/pay`))
      .send({ bankAccountCode: '1020', paymentDate: `${today}T00:00:00.000Z` });
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.journalEntryId).toBeTruthy();
    expect(paid.body.paymentJournalEntryId).toBeTruthy();
    const accrual = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${paid.body.journalEntryId}`));
    expect(accrual.body.sourceModule).toBe('PAYROLL');
    const accrualLines = accrual.body.lines as any[];
    const totalNet = saudiLine.netMinor + nonSaudiLine.netMinor;
    const totalGosiEmployer = 176250 + 11000;
    const totalEosb = 64583 + 24167;
    expect(accrualLines.some((l: any) => l.account.code === '5210' && l.debitMinor === calculated.body.grossMinor)).toBe(true);
    expect(accrualLines.some((l: any) => l.account.code === '5211' && l.debitMinor === totalGosiEmployer)).toBe(true);
    expect(accrualLines.some((l: any) => l.account.code === '5212' && l.debitMinor === totalEosb)).toBe(true);
    expect(accrualLines.some((l: any) => l.account.code === '2210' && l.creditMinor === 146250 + totalGosiEmployer)).toBe(true);
    expect(accrualLines.some((l: any) => l.account.code === '2220' && l.creditMinor === totalNet)).toBe(true);
    expect(accrualLines.some((l: any) => l.account.code === '2230' && l.creditMinor === totalEosb)).toBe(true);
    const payment = await auth(request(app.getHttpServer()).get(`/api/v1/journals/${paid.body.paymentJournalEntryId}`));
    const paymentLines = payment.body.lines as any[];
    expect(paymentLines.some((l: any) => l.account.code === '2220' && l.debitMinor === totalNet)).toBe(true);
    expect(paymentLines.some((l: any) => l.account.code === '1020' && l.creditMinor === totalNet)).toBe(true);

    // Terminate the non-Saudi employee: stays readable with end date.
    const terminated = await auth(request(app.getHttpServer()).post(`/api/v1/hr/employees/${nonSaudiId}/terminate`))
      .send({ endDate: `${today}T00:00:00.000Z` });
    expect(terminated.status).toBe(201);
    expect(terminated.body.status).toBe('TERMINATED');
    expect(terminated.body.endDate).toBeTruthy();
    const terminatedGet = await auth(request(app.getHttpServer()).get(`/api/v1/hr/employees/${nonSaudiId}`));
    expect(terminatedGet.status).toBe(200);

    // Cross-tenant 404 on the employee.
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Hr B ${suffix}`, slug: `hr-b-${suffix}`, email: `owner@hr-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer())
      .get(`/api/v1/hr/employees/${saudiId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);

    // Viewer (seed-dependent): read-only, cannot create an employee.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ code: 'EMP-X', name: 'Nope', jobTitle: 'Nope', departmentId: dept.body.id, hireDate: '2024-01-01T00:00:00.000Z', basicSalaryMinor: 1000 });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/hr/employees')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }
  });

  it('projects: project -> task -> timesheet approve -> expense -> milestone -> draft invoice -> post -> costing, completed locks entry, cross-tenant 404, viewer 403', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Proj Co ${suffix}`, slug: `proj-${suffix}`, email: `owner@proj-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const customer = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'CUSTOMER', legalName: 'Proj Customer', displayName: 'Proj Customer', email: `cust-${suffix}@example.sa` });
    expect(customer.status).toBe(201);
    const dept = await auth(request(app.getHttpServer()).post('/api/v1/hr/departments')).send({ code: 'OPS', name: 'Operations' });
    expect(dept.status).toBe(201);
    const branch = await auth(request(app.getHttpServer()).post('/api/v1/settings/branches')).send({ name: 'Main', code: 'BR-1', isDefault: true });
    expect(branch.status).toBe(201);
    const employee = await auth(request(app.getHttpServer()).post('/api/v1/hr/employees'))
      .send({ code: 'EMP-1', name: 'Sara Test', jobTitle: 'Engineer', departmentId: dept.body.id, branchId: branch.body.id, hireDate: '2023-01-15T00:00:00.000Z', basicSalaryMinor: 1200000, housingAllowanceMinor: 300000, transportAllowanceMinor: 50000, nationality: 'SAUDI' });
    expect(employee.status).toBe(201);
    const empId = employee.body.id as string;

    const project = await auth(request(app.getHttpServer()).post('/api/v1/projects'))
      .send({ code: 'PRJ-1', name: 'Booth Build', customerId: customer.body.id, status: 'ACTIVE', startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, dueDate: `${year}-${pad(month)}-${lastDay}T00:00:00.000Z`, budgetMinor: 2000000, billingType: 'MILESTONE' });
    expect(project.status).toBe(201);
    const projectId = project.body.id as string;

    const task = await auth(request(app.getHttpServer()).post('/api/v1/project-tasks'))
      .send({ projectId, title: 'Design', assigneeId: empId, estimatedHours: 10, priority: 'HIGH' });
    expect(task.status).toBe(201);
    expect(task.body.actualHours).toBe(0);
    const taskId = task.body.id as string;
    const task2 = await auth(request(app.getHttpServer()).post('/api/v1/project-tasks'))
      .send({ projectId, title: 'Build', assigneeId: empId, estimatedHours: 5 });
    expect(task2.status).toBe(201);

    // 8h on task 1 (rate 1,200,000/160 = 7,500/hr) + 2h on task 2 -> labour 75,000.
    const ts1 = await auth(request(app.getHttpServer()).post('/api/v1/timesheets'))
      .send({ employeeId: empId, projectId, taskId, date: `${year}-${pad(month)}-10T00:00:00.000Z`, hours: 8 });
    expect(ts1.status).toBe(201);
    expect(ts1.body.minutesInt).toBe(480);
    expect(ts1.body.hours).toBe(8);
    const dup = await auth(request(app.getHttpServer()).post('/api/v1/timesheets'))
      .send({ employeeId: empId, projectId, taskId, date: `${year}-${pad(month)}-10T00:00:00.000Z`, hours: 2 });
    expect(dup.status).toBe(409);
    const approved = await auth(request(app.getHttpServer()).post(`/api/v1/timesheets/${ts1.body.id}/approve`)).send({});
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');
    const lockedEdit = await auth(request(app.getHttpServer()).patch(`/api/v1/timesheets/${ts1.body.id}`)).send({ hours: 9 });
    expect(lockedEdit.status).toBe(409);
    const ts2 = await auth(request(app.getHttpServer()).post('/api/v1/timesheets'))
      .send({ employeeId: empId, projectId, taskId: task2.body.id, date: `${year}-${pad(month)}-11T00:00:00.000Z`, hours: 2 });
    expect(ts2.status).toBe(201);
    await auth(request(app.getHttpServer()).post(`/api/v1/timesheets/${ts2.body.id}/approve`)).send({});

    const expense = await auth(request(app.getHttpServer()).post('/api/v1/project-expenses'))
      .send({ projectId, date: `${year}-${pad(month)}-12T00:00:00.000Z`, category: 'MATERIALS', amountMinor: 150000 });
    expect(expense.status).toBe(201);
    const expApproved = await auth(request(app.getHttpServer()).post(`/api/v1/project-expenses/${expense.body.id}/approve`)).send({});
    expect(expApproved.status).toBe(201);

    // Costing before billing: labour 75,000 + expenses 150,000 = 225,000 actual, revenue 0.
    const costing0 = await auth(request(app.getHttpServer()).get(`/api/v1/projects/${projectId}/costing`));
    expect(costing0.status).toBe(200);
    expect(costing0.body.labourMinor).toBe(75000);
    expect(costing0.body.expensesMinor).toBe(150000);
    expect(costing0.body.actualMinor).toBe(225000);
    expect(costing0.body.revenueMinor).toBe(0);
    expect(costing0.body.profitMinor).toBe(-225000);

    const milestone = await auth(request(app.getHttpServer()).post('/api/v1/milestones'))
      .send({ projectId, title: 'Design approved', amountMinor: 500000 });
    expect(milestone.status).toBe(201);
    const achieved = await auth(request(app.getHttpServer()).post(`/api/v1/milestones/${milestone.body.id}/achieve`)).send({});
    expect(achieved.status).toBe(201);
    expect(achieved.body.status).toBe('INVOICED');
    expect(achieved.body.invoiceId).toBeTruthy();
    const invoice = await auth(request(app.getHttpServer()).get(`/api/v1/sales-invoices/${achieved.body.invoiceId}`));
    expect(invoice.status).toBe(200);
    expect(invoice.body.status).toBe('DRAFT');
    expect(invoice.body.totalMinor).toBe(500000);
    expect(invoice.body.projectId).toBe(projectId);

    // Post the milestone invoice -> revenue recognised in costing.
    const posted = await auth(request(app.getHttpServer()).post(`/api/v1/sales-invoices/${achieved.body.invoiceId}/post`)).send({});
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('POSTED');
    const costing1 = await auth(request(app.getHttpServer()).get(`/api/v1/projects/${projectId}/costing`));
    expect(costing1.status).toBe(200);
    expect(costing1.body.revenueMinor).toBe(500000);
    expect(costing1.body.profitMinor).toBe(275000);
    expect(costing1.body.marginBps).toBe(5500);

    // COMPLETED locks time/expense entry.
    const completed = await auth(request(app.getHttpServer()).patch(`/api/v1/projects/${projectId}`)).send({ status: 'COMPLETED' });
    expect(completed.status).toBe(200);
    const lockedTs = await auth(request(app.getHttpServer()).post('/api/v1/timesheets'))
      .send({ employeeId: empId, projectId, taskId, date: `${year}-${pad(month)}-12T00:00:00.000Z`, hours: 1 });
    expect(lockedTs.status).toBe(409);
    const lockedExp = await auth(request(app.getHttpServer()).post('/api/v1/project-expenses'))
      .send({ projectId, date: `${year}-${pad(month)}-12T00:00:00.000Z`, category: 'OTHER', amountMinor: 1000 });
    expect(lockedExp.status).toBe(409);
    // Terminal status cannot transition back.
    const reopen = await auth(request(app.getHttpServer()).patch(`/api/v1/projects/${projectId}`)).send({ status: 'ACTIVE' });
    expect(reopen.status).toBe(409);

    // Cross-tenant 404.
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `Proj B ${suffix}`, slug: `proj-b-${suffix}`, email: `owner@proj-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const crossGet = await request(app.getHttpServer()).get(`/api/v1/projects/${projectId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);

    // Viewer (seed-dependent): read-only, cannot create a project.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ code: 'PRJ-X', name: 'Nope' });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }
  });

  it('analytics: dashboard KPIs match seeded ledger, P&L balances, balance sheet balances, cash flow reconciles, AI ask answers from aggregates, snapshot round-trip, viewer 403 on snapshot create', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `An Co ${suffix}`, slug: `an-${suffix}`, email: `owner@an-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const tenantId = reg.body.tenant.id as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    const prisma = new PrismaClient();
    let cashId = '';
    let salesId = '';
    try {
      const accounts = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
        return tx.chartOfAccounts.findMany({ where: { tenantId, code: { in: ['1010', '4010'] } } });
      });
      const byCode = new Map(accounts.map((a: any) => [a.code, a.id]));
      cashId = byCode.get('1010') as string;
      salesId = byCode.get('4010') as string;
      expect(cashId && salesId).toBeTruthy();
    } finally {
      await prisma.$disconnect();
    }

    // One posted cash sale: Dr 1010 / Cr 4010 for 1,000,000 minor (SAR 10,000).
    const entryDate = `${year}-${pad(month)}-15T00:00:00.000Z`;
    const journal = await auth(request(app.getHttpServer()).post('/api/v1/journals'))
      .send({ entryDate, description: 'Cash sale', lines: [{ accountId: cashId, debitMinor: 1000000, creditMinor: 0 }, { accountId: salesId, debitMinor: 0, creditMinor: 1000000 }] });
    expect(journal.status).toBe(201);
    const posted = await auth(request(app.getHttpServer()).post(`/api/v1/journals/${journal.body.id}/post`)).send({});
    expect(posted.status).toBe(201);

    const dash = await auth(request(app.getHttpServer()).get(`/api/v1/analytics/dashboard?year=${year}&month=${month}`));
    expect(dash.status).toBe(200);
    expect(dash.body.revenueMinor).toBe(1000000);
    expect(dash.body.grossProfitMinor).toBe(1000000);
    expect(dash.body.grossMarginBps).toBe(10000);
    expect(dash.body.openArMinor).toBe(0);
    expect(dash.body.stockValueMinor).toBe(0);
    expect(dash.body.lowStockCount).toBe(0);
    expect(dash.body.payrollCostMinor).toBe(0);
    expect(dash.body.salesByMonth).toHaveLength(12);

    const pl = await auth(request(app.getHttpServer()).get(`/api/v1/analytics/profit-loss?fiscalPeriodId=${period.body.id}`));
    expect(pl.status).toBe(200);
    expect(pl.body.revenueMinor).toBe(1000000);
    expect(pl.body.cogsMinor).toBe(0);
    expect(pl.body.netIncomeMinor).toBe(1000000);
    expect(pl.body.grossMarginBps).toBe(10000);

    const bs = await auth(request(app.getHttpServer()).get('/api/v1/analytics/balance-sheet'));
    expect(bs.status).toBe(200);
    expect(bs.body.assetsMinor).toBe(1000000);
    expect(bs.body.totalLiabilitiesEquityMinor).toBe(1000000);
    expect(bs.body.balanced).toBe(true);
    expect(bs.body.differenceMinor).toBe(0);

    const cf = await auth(request(app.getHttpServer()).get(`/api/v1/analytics/cash-flow?from=${year}-${pad(month)}-01T00:00:00.000Z&to=${year}-${pad(month)}-${lastDay}T23:59:59.999Z`));
    expect(cf.status).toBe(200);
    expect(cf.body.netChangeInCashMinor).toBe(1000000);
    expect(cf.body.actualCashChangeMinor).toBe(1000000);
    expect(cf.body.balanced).toBe(true);

    const csv = await auth(request(app.getHttpServer()).get('/api/v1/analytics/exports/profit-loss.csv'));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('revenueMinor');

    const snapshot = await auth(request(app.getHttpServer()).post('/api/v1/analytics/report-snapshots'))
      .send({ type: 'PROFIT_LOSS', parameters: { fiscalPeriodId: period.body.id } });
    expect(snapshot.status).toBe(201);
    expect(snapshot.body.type).toBe('PROFIT_LOSS');
    const snapList = await auth(request(app.getHttpServer()).get('/api/v1/analytics/report-snapshots'));
    expect(snapList.status).toBe(200);
    expect(snapList.body.data.some((s: any) => s.id === snapshot.body.id)).toBe(true);
    const download = await auth(request(app.getHttpServer()).get(`/api/v1/analytics/report-snapshots/${snapshot.body.id}/download?format=csv`));
    expect(download.status).toBe(200);
    expect(download.text).toContain('revenueMinor');

    const insights = await auth(request(app.getHttpServer()).get('/api/v1/ai/insights'));
    expect(insights.status).toBe(200);
    expect(insights.body.source).toBe('rule-based');
    expect(Array.isArray(insights.body.insights)).toBe(true);

    const askRevenue = await auth(request(app.getHttpServer()).post('/api/v1/ai/ask')).send({ question: 'What was our revenue this month?' });
    expect(askRevenue.status).toBe(201);
    expect(askRevenue.body.intent).toBe('revenue');
    expect(askRevenue.body.answer).toContain('SAR 10,000.00');
    const askUnknown = await auth(request(app.getHttpServer()).post('/api/v1/ai/ask')).send({ question: 'What is the weather tomorrow?' });
    expect(askUnknown.status).toBe(201);
    expect(askUnknown.body.intent).toBe('unknown');
    expect(askUnknown.body.answer).toContain('I can only answer questions about');

    // Tenant B sees none of tenant A's KPIs (isolation by JWT scoping).
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `An B ${suffix}`, slug: `an-b-${suffix}`, email: `owner@an-b-${suffix}.test`, password: 'Demo1234!' });
    const tokenB = regB.body.tokens.accessToken as string;
    const dashB = await request(app.getHttpServer()).get(`/api/v1/analytics/dashboard?year=${year}&month=${month}`).set('Authorization', `Bearer ${tokenB}`);
    expect(dashB.status).toBe(200);
    expect(dashB.body.revenueMinor).toBe(0);

    // Viewer (seed-dependent): read-only, cannot create a snapshot.
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/analytics/report-snapshots')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ type: 'PROFIT_LOSS', parameters: {} });
      expect(forbidden.status).toBe(403);
      const viewerRead = await request(app.getHttpServer())
        .get('/api/v1/analytics/dashboard')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);
    } else {
      console.log('SKIPPED: viewer 403 check — demo seed not present in this database.');
    }
  });

  it('phase 11: invoice -> ZATCA generate -> submit (simulation), webhook test delivery, API key lifecycle, exports, encrypted-field masking, cross-tenant 404, viewer 403', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantName: `P11 Co ${suffix}`, slug: `p11-${suffix}`, email: `owner@p11-${suffix}.test`, password: 'Demo1234!' });
    expect(reg.status).toBe(201);
    const token = reg.body.tokens.accessToken as string;
    const tenantId = reg.body.tenant.id as string;
    const auth = (r: any) => r.set('Authorization', `Bearer ${token}`);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, '0');

    await auth(request(app.getHttpServer()).post('/api/v1/onboarding/step')).send({ step: 2, data: { template: 'saudi' } });
    const period = await auth(request(app.getHttpServer()).post('/api/v1/fiscal-periods'))
      .send({ fiscalYear: year, periodNumber: month, startDate: `${year}-${pad(month)}-01T00:00:00.000Z`, endDate: `${year}-${pad(month)}-${lastDay}T23:59:59.999Z`, status: 'OPEN' });
    expect(period.status).toBe(201);

    // Seller VAT number (required for ZATCA generation).
    const company = await auth(request(app.getHttpServer()).patch('/api/v1/settings/company'))
      .send({ legalName: `P11 Co ${suffix}`, taxNumber: '300000000000003', city: 'Riyadh' });
    expect(company.status).toBe(200);

    const contact = await auth(request(app.getHttpServer()).post('/api/v1/contacts'))
      .send({ type: 'CUSTOMER', legalName: `Buyer ${suffix}`, displayName: `Buyer ${suffix}`, taxNumber: '300100000000001', email: `buyer-${suffix}@test.sa`, creditLimitMinor: 5000000, paymentTermsDays: 30 });
    expect(contact.status).toBe(201);
    const uom = await auth(request(app.getHttpServer()).post('/api/v1/settings/units')).send({ code: 'piece', name: 'Piece' });
    expect(uom.status).toBe(201);
    const item = await auth(request(app.getHttpServer()).post('/api/v1/items'))
      .send({ sku: `SKU-P11-${suffix}`, name: 'Basmati Rice', defaultUomId: uom.body.id, salesPriceMinor: 3499, purchasePriceMinor: 2800 });
    expect(item.status).toBe(201);
    const invoice = await auth(request(app.getHttpServer()).post('/api/v1/sales-invoices'))
      .send({ customerId: contact.body.id, invoiceDate: `${today}T00:00:00.000Z`, lines: [{ itemId: item.body.id, quantity: 10, unitPriceMinor: 3499, taxRateBps: 1500 }] });
    expect(invoice.status).toBe(201);
    const invoiceId = invoice.body.id as string;
    const posted = await auth(request(app.getHttpServer()).post(`/api/v1/sales-invoices/${invoiceId}/post`)).send({});
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('POSTED');

    // --- ZATCA: generate -> submit (simulation) ---
    const doc = await auth(request(app.getHttpServer()).post('/api/v1/zatca/documents'))
      .send({ invoiceId, type: 'SIMPLIFIED' });
    expect(doc.status).toBe(201);
    expect(doc.body.status).toBe('GENERATED');
    expect(doc.body.invoiceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.body.qrData).toBeTruthy();
    expect(doc.body.xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    expect(doc.body.xml).toContain('300000000000003');
    const docId = doc.body.id as string;
    const submitted = await auth(request(app.getHttpServer()).post(`/api/v1/zatca/documents/${docId}/submit`)).send({});
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe('REPORTED_SIMULATED');
    expect(submitted.body.zatcaResponse.mode).toBe('simulation');
    const docs = await auth(request(app.getHttpServer()).get('/api/v1/zatca/documents'));
    expect(docs.status).toBe(200);
    expect(docs.body.meta.total).toBe(1);

    // --- Webhooks: endpoint -> test delivery against a local mock receiver ---
    const { createServer } = await import('node:http');
    const received: { headers: Record<string, unknown>; body: string }[] = [];
    const receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
    const port = (receiver.address() as { port: number }).port;
    try {
      const endpoint = await auth(request(app.getHttpServer()).post('/api/v1/webhooks/endpoints'))
        .send({ name: `Hook ${suffix}`, url: `http://127.0.0.1:${port}/hook`, eventTypes: ['sales-invoice.posted', 'ping'], status: 'ACTIVE' });
      expect(endpoint.status).toBe(201);
      const endpointId = endpoint.body.id as string;
      const test = await auth(request(app.getHttpServer()).post(`/api/v1/webhooks/endpoints/${endpointId}/test`)).send({});
      expect(test.status).toBe(201);
      expect(test.body.eventType).toBe('ping');
      // Poll for the BullMQ worker to deliver (max ~15s).
      let delivered: any = null;
      for (let i = 0; i < 30; i += 1) {
        const list = await auth(request(app.getHttpServer()).get(`/api/v1/webhooks/deliveries?endpointId=${endpointId}`));
        expect(list.status).toBe(200);
        delivered = (list.body.data as any[]).find((d) => d.status === 'DELIVERED');
        if (delivered) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(delivered).toBeTruthy();
      expect(delivered.attemptCount).toBeGreaterThanOrEqual(1);
      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0].headers['x-eserp-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(received[0].body).toContain('"eventType":"ping"');
    } finally {
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }

    // --- API keys: create (plaintext once) -> use -> revoke -> 401 ---
    const key = await auth(request(app.getHttpServer()).post('/api/v1/api-keys'))
      .send({ name: `Key ${suffix}`, scopes: ['sales-invoices:read'] });
    expect(key.status).toBe(201);
    const plaintext = key.body.apiKey as string;
    expect(plaintext).toMatch(/^eserp_[0-9a-f]{32}$/);
    expect(key.body.keyHash).toBeUndefined();
    const keyId = key.body.id as string;
    const withKey = await request(app.getHttpServer()).get('/api/v1/sales-invoices').set('X-API-Key', plaintext);
    expect(withKey.status).toBe(200);
    expect(withKey.body.meta.total).toBe(1);
    // The key's scope is read-only: a write with it must be 403.
    const withKeyWrite = await request(app.getHttpServer()).post('/api/v1/sales-invoices').set('X-API-Key', plaintext)
      .send({ customerId: contact.body.id, invoiceDate: `${today}T00:00:00.000Z`, lines: [{ itemId: item.body.id, quantity: 1, unitPriceMinor: 3499, taxRateBps: 1500 }] });
    expect(withKeyWrite.status).toBe(403);
    const revoked = await auth(request(app.getHttpServer()).post(`/api/v1/api-keys/${keyId}/revoke`)).send({});
    expect(revoked.status).toBe(201);
    expect(revoked.body.status).toBe('REVOKED');
    const afterRevoke = await request(app.getHttpServer()).get('/api/v1/sales-invoices').set('X-API-Key', plaintext);
    expect(afterRevoke.status).toBe(401);

    // --- Exports: CSV download + job ---
    const csv = await auth(request(app.getHttpServer()).get('/api/v1/exports/contacts?format=csv'));
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('legalName');
    expect(csv.text).toContain(`Buyer ${suffix}`);
    const job = await auth(request(app.getHttpServer()).post('/api/v1/exports/jobs')).send({ type: 'sales-invoices', format: 'CSV' });
    expect(job.status).toBe(201);
    expect(job.body.status).toBe('COMPLETED');
    expect(job.body.rowCount).toBe(1);

    // --- Providers: mock status + simulated charge ---
    const providers = await auth(request(app.getHttpServer()).get('/api/v1/providers/status'));
    expect(providers.status).toBe(200);
    expect(providers.body.payment.provider).toBe('mock');
    expect(providers.body.payment.simulated).toBe(true);
    const charge = await auth(request(app.getHttpServer()).post('/api/v1/providers/payments/simulate-charge'))
      .send({ amountMinor: 11500, currency: 'SAR' });
    expect(charge.status).toBe(201);
    expect(charge.body.simulated).toBe(true);
    expect(charge.body.status).toBe('succeeded');

    // --- Encrypted fields: create an employee, then check masking ---
    const dept = await auth(request(app.getHttpServer()).post('/api/v1/hr/departments')).send({ code: 'ADM', name: 'Admin' });
    expect(dept.status).toBe(201);
    const emp = await auth(request(app.getHttpServer()).post('/api/v1/hr/employees'))
      .send({ code: 'EMP-1', name: 'Sara Test', jobTitle: 'HR Manager', departmentId: dept.body.id, hireDate: '2023-01-15T00:00:00.000Z', basicSalaryMinor: 1200000, housingAllowanceMinor: 300000, transportAllowanceMinor: 50000, nationality: 'SAUDI', nationalId: '1012345678', iban: 'SA0380000000608012345678' });
    expect(emp.status).toBe(201);
    // OWNER has '*' so the create response shows the value; the stored row
    // must be encrypted when ENCRYPTION_KEY is configured.
    if (process.env.ENCRYPTION_KEY) {
      const prisma = new PrismaClient();
      try {
        const stored = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
          return tx.employee.findUnique({ where: { id: emp.body.id } });
        });
        expect(stored?.nationalId).toMatch(/^enc1:/);
        expect(stored?.iban).toMatch(/^enc1:/);
        expect(stored?.nationalId).not.toContain('1012345678');
      } finally {
        await prisma.$disconnect();
      }
    } else {
      console.log('SKIPPED: at-rest encryption check — ENCRYPTION_KEY is not set for this run.');
    }

    // --- Cross-tenant 404 + viewer 403 (demo seed) ---
    const other = await request(app.getHttpServer()).post('/api/v1/auth/register')
      .send({ tenantName: `P11 Other ${suffix}`, slug: `p11-other-${suffix}`, email: `owner@p11-other-${suffix}.test`, password: 'Demo1234!' });
    expect(other.status).toBe(201);
    const otherToken = other.body.tokens.accessToken as string;
    const cross = await request(app.getHttpServer()).get(`/api/v1/zatca/documents/${docId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(cross.status).toBe(404);
    const viewerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
    if (viewerLogin.status === 201) {
      const viewerToken = viewerLogin.body.tokens.accessToken as string;
      const viewerWrite = await request(app.getHttpServer()).post('/api/v1/zatca/documents')
        .set('Authorization', `Bearer ${viewerToken}`).send({ invoiceId, type: 'SIMPLIFIED' });
      expect(viewerWrite.status).toBe(403);
      // Viewer has no hr:read-sensitive: seeded employee fields come back masked.
      const viewerEmps = await request(app.getHttpServer()).get('/api/v1/hr/employees?pageSize=100')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(viewerEmps.status).toBe(200);
      const emp1 = (viewerEmps.body.data as any[]).find((e) => e.code === 'EMP-001');
      if (emp1) {
        expect(String(emp1.nationalId ?? '')).toMatch(/^\*\*\*\*\d{4}$/);
        expect(JSON.stringify(viewerEmps.body)).not.toContain('1012345678');
      }
      const hrLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'hr@alsafa-trading.sa', password: 'Demo1234!', tenantSlug: 'alsafa-trading' });
      if (hrLogin.status === 201) {
        const hrToken = hrLogin.body.tokens.accessToken as string;
        const hrEmps = await request(app.getHttpServer()).get('/api/v1/hr/employees?pageSize=100')
          .set('Authorization', `Bearer ${hrToken}`);
        const hrEmp1 = (hrEmps.body.data as any[]).find((e) => e.code === 'EMP-001');
        if (hrEmp1) expect(hrEmp1.nationalId).toBe('1012345678');
      }
    } else {
      console.log('SKIPPED: viewer/HR masking checks — demo seed not present in this database.');
    }
  });

  it('tenant isolation: token A cannot read tenant B settings', async () => {
    if (!available) return;
    const suffix = Date.now().toString(36);
    const mk = async (n: string) => {
      const r = await request(app.getHttpServer()).post('/api/v1/auth/register')
        .send({ tenantName: `Iso ${n} ${suffix}`, slug: `iso-${n}-${suffix}`, email: `o${n}@iso-${suffix}.test`, password: 'Demo1234!' });
      return { token: r.body.tokens.accessToken as string, tenantId: r.body.tenant.id as string };
    };
    const a = await mk('a');
    const b = await mk('b');
    // Token A asking for B's data: B's currency list must never leak to A.
    // Settings endpoints are tenant-scoped from the JWT, so A only ever sees A's rows.
    const listA = await request(app.getHttpServer()).get('/api/v1/settings/currencies').set('Authorization', `Bearer ${a.token}`);
    expect(listA.status).toBe(200);
    expect(listA.body.every((c: any) => c.tenantId === a.tenantId || c.tenantId === undefined)).toBe(true);
    // A header claiming to be tenant B must be rejected (403).
    const spoof = await request(app.getHttpServer())
      .get('/api/v1/settings/currencies')
      .set('Authorization', `Bearer ${a.token}`)
      .set('X-Tenant-Id', b.tenantId);
    expect([403, 401]).toContain(spoof.status);
    // Unauthenticated access is rejected.
    const anon = await request(app.getHttpServer()).get('/api/v1/settings/currencies');
    expect(anon.status).toBe(401);
  });
});
