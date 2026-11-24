import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

/**
 * Phase 11 RLS integration test — proves tenant A can never read tenant B's
 * ZatcaDocument / WebhookEndpoint / WebhookDelivery / ApiKey / ExportJob
 * rows at the database level (FORCE ROW LEVEL SECURITY + tenant_isolation).
 * Same skip/fail-loud rules as rls.test.ts: skipped without DATABASE_URL,
 * fails loudly on a superuser connection (superusers bypass RLS).
 */
describe('Phase 11 RLS (integrations)', () => {
  it('isolates the Phase 11 tables at the database level', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log('SKIPPED: Phase 11 RLS test — DATABASE_URL is not set (needs Postgres + migrations).');
      return;
    }
    let prisma: import('@prisma/client').PrismaClient;
    try {
      const mod = await import('@prisma/client');
      prisma = new mod.PrismaClient();
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      console.log(`SKIPPED: Phase 11 RLS test — database unreachable (${(err as Error).message}).`);
      return;
    }

    const [{ usesuper }] = await prisma.$queryRawUnsafe<{ usesuper: boolean }[]>(
      `SELECT usesuper FROM pg_user WHERE usename = current_user`,
    );
    if (usesuper) {
      await prisma.$disconnect();
      throw new Error('Phase 11 RLS test must run as a NON-superuser app role (e.g. eserp_app): superusers bypass RLS.');
    }

    const suffix = Date.now().toString(36);
    const tenantA = await prisma.tenant.create({ data: { name: `P11 A ${suffix}`, slug: `p11-a-${suffix}` } });
    const tenantB = await prisma.tenant.create({ data: { name: `P11 B ${suffix}`, slug: `p11-b-${suffix}` } });
    try {
      const ids: Record<string, { zatcaId: string; endpointId: string; deliveryId: string; keyId: string; jobId: string }> = {};
      for (const t of [tenantA, tenantB]) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${t.id}'`);
          const contact = await tx.contact.create({ data: { tenantId: t.id, type: 'CUSTOMER', legalName: `Customer ${t.slug}`, displayName: `Customer ${t.slug}` } });
          const invoice = await tx.salesInvoice.create({
            data: {
              tenantId: t.id, number: `INV-P11-${t === tenantA ? 'A' : 'B'}`, customerId: contact.id,
              status: 'POSTED', invoiceDate: new Date('2026-11-24T00:00:00.000Z'), dueDate: new Date('2026-12-24T00:00:00.000Z'),
              subtotalMinor: 100000n, taxMinor: 15000n, totalMinor: 115000n,
            },
          });
          const zatca = await tx.zatcaDocument.create({
            data: {
              tenantId: t.id, invoiceId: invoice.id, type: 'SIMPLIFIED', uuid: `uuid-${t.slug}`,
              xml: '<Invoice/>', invoiceHash: createHash('sha256').update(`xml-${t.slug}`).digest('hex'),
              qrData: 'dGVzdA==', status: 'GENERATED',
            },
          });
          const endpoint = await tx.webhookEndpoint.create({
            data: { tenantId: t.id, name: `Hook ${t.slug}`, url: 'https://example.com/hook', secret: 'secret', eventTypes: ['sales-invoice.posted'], status: 'ACTIVE' },
          });
          const delivery = await tx.webhookDelivery.create({
            data: { tenantId: t.id, endpointId: endpoint.id, eventType: 'sales-invoice.posted', payload: { id: invoice.id }, status: 'PENDING' },
          });
          // The API key stores ONLY the hash — the plaintext is never persisted.
          const plaintext = `eserp_test_${t.slug}`;
          const key = await tx.apiKey.create({
            data: { tenantId: t.id, name: `Key ${t.slug}`, keyHash: createHash('sha256').update(plaintext).digest('hex'), keyPrefix: plaintext.slice(-4), scopes: ['sales-invoices:read'], status: 'ACTIVE' },
          });
          const job = await tx.exportJob.create({ data: { tenantId: t.id, type: 'contacts', format: 'CSV', status: 'COMPLETED', rowCount: 1 } });
          ids[t.id] = { zatcaId: zatca.id, endpointId: endpoint.id, deliveryId: delivery.id, keyId: key.id, jobId: job.id };
        });
      }

      // Tenant A sees only its own rows, tenant B only its own.
      for (const [tenant, other] of [[tenantA, tenantB], [tenantB, tenantA]] as const) {
        const own = ids[tenant.id];
        const theirs = ids[other.id];
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant.id}'`);
          expect(await tx.zatcaDocument.findMany()).toHaveLength(1);
          expect((await tx.zatcaDocument.findMany())[0].id).toBe(own.zatcaId);
          expect(await tx.zatcaDocument.findUnique({ where: { id: theirs.zatcaId } })).toBeNull();
          expect(await tx.webhookEndpoint.findMany()).toHaveLength(1);
          expect(await tx.webhookEndpoint.findUnique({ where: { id: theirs.endpointId } })).toBeNull();
          expect(await tx.webhookDelivery.findMany()).toHaveLength(1);
          expect(await tx.webhookDelivery.findUnique({ where: { id: theirs.deliveryId } })).toBeNull();
          expect(await tx.apiKey.findMany()).toHaveLength(1);
          expect(await tx.apiKey.findUnique({ where: { id: theirs.keyId } })).toBeNull();
          expect(await tx.exportJob.findMany()).toHaveLength(1);
          expect(await tx.exportJob.findUnique({ where: { id: theirs.jobId } })).toBeNull();
          // The stored API key row contains a hash, never the plaintext.
          const stored = (await tx.apiKey.findMany())[0];
          expect(stored.keyHash).toBe(createHash('sha256').update(`eserp_test_${tenant.slug}`).digest('hex'));
          expect(stored.keyHash).not.toContain('eserp_test_');
        });
      }

      // Cross-tenant writes are rejected by RLS (WITH CHECK).
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantA.id}'`);
          await tx.exportJob.create({ data: { tenantId: tenantB.id, type: 'items', format: 'CSV', status: 'PENDING', rowCount: 0 } });
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.$disconnect();
    }
  });
});
