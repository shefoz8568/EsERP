/**
 * EsERP seed — Saudi demo tenant (idempotent: every write is an upsert keyed
 * on a unique constraint, so re-running the seed is safe).
 *
 * Demo tenant: شركة الصفاء للتجارة / Al-Safa Trading Co. (slug alsafa-trading)
 * - Default currency SAR, locale ar, fiscal year starts January, Gregorian
 *   calendar (Hijri is supported per-tenant via calendarType; the demo uses
 *   Gregorian as the accounting calendar).
 * - Saudi CoA template (prisma/data/saudi-coa.json), 15% VAT, SAR/USD/EUR/AED,
 *   UoM + conversions, one warehouse + one branch in Riyadh.
 * - Users: owner + one per role, all password `Demo1234!` (argon2, demo only).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, ROLE_PERMISSION_MATRIX, calculatePayrollLine, computeProfitLoss, expandPermissions, type RoleName } from '@eserp/shared';
import { FieldEncryptor } from '../src/encryption.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? 'Demo1234!';
const TENANT_SLUG = 'alsafa-trading';
const TENANT_NAME = 'Al-Safa Trading Co.';
const DOMAIN = 'alsafa-trading.sa';

const ROLE_USERS: { role: RoleName; email: string; firstName: string }[] = [
  { role: 'OWNER', email: `admin@${DOMAIN}`, firstName: 'Owner' },
  { role: 'ACCOUNTANT', email: `accountant@${DOMAIN}`, firstName: 'Accountant' },
  { role: 'SALES', email: `sales@${DOMAIN}`, firstName: 'Sales' },
  { role: 'PURCHASING', email: `purchasing@${DOMAIN}`, firstName: 'Purchasing' },
  { role: 'WAREHOUSE', email: `warehouse@${DOMAIN}`, firstName: 'Warehouse' },
  { role: 'HR', email: `hr@${DOMAIN}`, firstName: 'HR' },
  { role: 'VIEWER', email: `viewer@${DOMAIN}`, firstName: 'Viewer' },
];

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  // Global permission catalog (not tenant-scoped).
  for (const name of ALL_PERMISSIONS) {
    const [module, action] = name.split(':');
    await prisma.permission.upsert({
      where: { name },
      update: { module, action },
      create: { name, module, action, description: `${module} — ${action}` },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permByName = new Map(permissions.map((p) => [p.name, p.id]));

  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME, defaultCurrency: 'SAR', defaultLocale: 'ar', fiscalYearStartMonth: 1, calendarType: 'gregorian', status: 'active' },
    create: { name: TENANT_NAME, slug: TENANT_SLUG, defaultCurrency: 'SAR', defaultLocale: 'ar', fiscalYearStartMonth: 1, calendarType: 'gregorian', status: 'active' },
  });
  const tenantId = tenant.id;

  // All tenant-scoped writes run with the RLS tenant context set.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);

    await tx.companyProfile.upsert({
      where: { tenantId },
      update: { legalName: 'شركة الصفاء للتجارة', tradeName: 'Al-Safa Trading Co.', city: 'الرياض', country: 'SA' },
      create: {
        tenantId, legalName: 'شركة الصفاء للتجارة', tradeName: 'Al-Safa Trading Co.',
        taxNumber: '300000000000003', commercialRegistration: '1010000000',
        phone: '+966112345678', email: `info@${DOMAIN}`, city: 'الرياض', region: 'الرياض', country: 'SA',
      },
    });

    // Roles + permission matrix.
    const roleIds = new Map<string, string>();
    for (const roleName of Object.keys(ROLE_PERMISSION_MATRIX) as RoleName[]) {
      const role = await tx.role.upsert({
        where: { name_tenantId: { name: roleName, tenantId } },
        update: { isSystem: true },
        create: { tenantId, name: roleName, description: `${roleName} (system role)`, isSystem: true },
      });
      roleIds.set(roleName, role.id);
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      for (const perm of expandPermissions(ROLE_PERMISSION_MATRIX[roleName])) {
        const permissionId = permByName.get(perm);
        if (!permissionId) continue;
        await tx.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId } });
      }
    }

    // Users (one per role) + role assignments.
    for (const u of ROLE_USERS) {
      const user = await tx.user.upsert({
        where: { email_tenantId: { email: u.email, tenantId } },
        update: { passwordHash, isActive: true, locale: 'ar', firstName: u.firstName, lastName: 'Al-Safa' },
        create: { tenantId, email: u.email, passwordHash, firstName: u.firstName, lastName: 'Al-Safa', locale: 'ar', isActive: true },
      });
      const roleId = roleIds.get(u.role)!;
      // ADMIN also gets the ADMIN role in addition to OWNER for the owner user.
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { tenantId, userId: user.id, roleId },
      });
    }
    // Owner additionally holds ADMIN.
    const owner = await tx.user.findUniqueOrThrow({ where: { email_tenantId: { email: `admin@${DOMAIN}`, tenantId } } });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: owner.id, roleId: roleIds.get('ADMIN')! } },
      update: {},
      create: { tenantId, userId: owner.id, roleId: roleIds.get('ADMIN')! },
    });

    // Currencies + exchange rates to SAR (rational, no floats).
    const currencies: { code: string; name: string; symbol: string; isDefault: boolean }[] = [
      { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س', isDefault: true },
      { code: 'USD', name: 'US Dollar', symbol: '$', isDefault: false },
      { code: 'EUR', name: 'Euro', symbol: '€', isDefault: false },
      { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', isDefault: false },
    ];
    for (const c of currencies) {
      await tx.currency.upsert({
        where: { code_tenantId: { code: c.code, tenantId } },
        update: { name: c.name, symbol: c.symbol, isDefault: c.isDefault },
        create: { tenantId, ...c },
      });
    }
    const rates: { from: string; num: bigint; den: bigint }[] = [
      { from: 'USD', num: 375n, den: 100n }, // 1 USD = 3.75 SAR (peg)
      { from: 'EUR', num: 406n, den: 100n }, // indicative
      { from: 'AED', num: 1021n, den: 1000n }, // indicative
    ];
    for (const r of rates) {
      await tx.exchangeRate.upsert({
        where: { fromCurrencyCode_toCurrencyCode_effectiveDate_tenantId: { fromCurrencyCode: r.from, toCurrencyCode: 'SAR', effectiveDate: new Date('2026-01-01T00:00:00.000Z'), tenantId } },
        update: { rateNumerator: r.num, rateDenominator: r.den },
        create: { tenantId, fromCurrencyCode: r.from, toCurrencyCode: 'SAR', rateNumerator: r.num, rateDenominator: r.den, effectiveDate: new Date('2026-01-01T00:00:00.000Z') },
      });
    }

    // VAT: 15% standard (Saudi), 0% zero-rated, exempt.
    const taxes = [
      { name: 'VAT 15%', nameAr: 'ضريبة القيمة المضافة 15%', rateBps: 1500, type: 'standard', isDefault: true },
      { name: 'VAT 0% (zero-rated)', nameAr: 'ضريبة صفرية', rateBps: 0, type: 'zero_rated', isDefault: false },
      { name: 'VAT exempt', nameAr: 'معفاة من الضريبة', rateBps: 0, type: 'exempt', isDefault: false },
    ];
    for (const t of taxes) {
      await tx.taxRate.upsert({
        where: { name_tenantId: { name: t.name, tenantId } },
        update: { rateBps: t.rateBps, type: t.type, isDefault: t.isDefault },
        create: { tenantId, ...t, isInclusive: false },
      });
    }

    // Units of measure + conversions.
    const uoms = [
      { code: 'g', name: 'Gram', nameAr: 'غرام' },
      { code: 'kg', name: 'Kilogram', nameAr: 'كيلوغرام' },
      { code: 'piece', name: 'Piece', nameAr: 'قطعة' },
      { code: 'box', name: 'Box', nameAr: 'صندوق' },
      { code: 'carton', name: 'Carton', nameAr: 'كرتون' },
      { code: 'litre', name: 'Litre', nameAr: 'لتر' },
    ];
    const uomIds = new Map<string, string>();
    for (const u of uoms) {
      const row = await tx.unitOfMeasure.upsert({
        where: { code_tenantId: { code: u.code, tenantId } },
        update: { name: u.name, nameAr: u.nameAr },
        create: { tenantId, ...u },
      });
      uomIds.set(u.code, row.id);
    }
    const conversions: { from: string; to: string; num: bigint; den: bigint }[] = [
      { from: 'carton', to: 'piece', num: 12n, den: 1n },
      { from: 'box', to: 'piece', num: 24n, den: 1n },
      { from: 'kg', to: 'g', num: 1000n, den: 1n },
    ];
    for (const c of conversions) {
      await tx.uomConversion.upsert({
        where: { fromUomId_toUomId_tenantId: { fromUomId: uomIds.get(c.from)!, toUomId: uomIds.get(c.to)!, tenantId } },
        update: { factorNumerator: c.num, factorDenominator: c.den },
        create: { tenantId, fromUomId: uomIds.get(c.from)!, toUomId: uomIds.get(c.to)!, factorNumerator: c.num, factorDenominator: c.den },
      });
    }

    // Numbering series.
    const series = [
      { code: 'INV', name: 'Sales Invoices', pattern: 'INV-{YYYY}-{SEQ:5}' },
      { code: 'QUO', name: 'Quotations', pattern: 'QUO-{YYYY}-{SEQ:5}' },
      { code: 'SO', name: 'Sales Orders', pattern: 'SO-{YYYY}-{SEQ:5}' },
      { code: 'PO', name: 'Purchase Orders', pattern: 'PO-{YYYY}-{SEQ:5}' },
      { code: 'PAY', name: 'Payments', pattern: 'PAY-{YYYY}-{SEQ:5}' },
      { code: 'SIN', name: 'Supplier Invoices', pattern: 'SIN-{YYYY}-{SEQ:5}' },
      { code: 'SPAY', name: 'Supplier Payments', pattern: 'SPAY-{YYYY}-{SEQ:5}' },
      { code: 'GRN', name: 'Goods Receipts', pattern: 'GRN-{YYYY}-{SEQ:5}' },
      { code: 'DN', name: 'Delivery Notes', pattern: 'DN-{YYYY}-{SEQ:5}' },
      { code: 'ADJ', name: 'Stock Adjustments', pattern: 'ADJ-{YYYY}-{SEQ:5}' },
      { code: 'TRF', name: 'Stock Transfers', pattern: 'TRF-{YYYY}-{SEQ:5}' },
      { code: 'CNT', name: 'Stock Counts', pattern: 'CNT-{YYYY}-{SEQ:5}' },
      { code: 'POS', name: 'POS Sales', pattern: 'POS-{YYYY}-{SEQ:5}' },
      { code: 'WO', name: 'Work Orders', pattern: 'WO-{YYYY}-{SEQ:5}' },
      { code: 'MI', name: 'Material Issues', pattern: 'MI-{YYYY}-{SEQ:5}' },
      { code: 'PR', name: 'Production Receipts', pattern: 'PR-{YYYY}-{SEQ:5}' },
      { code: 'SCR', name: 'Scrap Records', pattern: 'SCR-{YYYY}-{SEQ:5}' },
      { code: 'JE', name: 'Journal Entries', pattern: 'JE-{YYYY}-{SEQ:5}' },
    ];
    for (const s of series) {
      await tx.numberingSeries.upsert({
        where: { code_tenantId: { code: s.code, tenantId } },
        update: { name: s.name, pattern: s.pattern },
        create: { tenantId, ...s, nextNumber: 1 },
      });
    }

    await tx.warehouse.upsert({
      where: { code_tenantId: { code: 'WH-RIY-01', tenantId } },
      update: { name: 'Main Warehouse', nameAr: 'المستودع الرئيسي - الرياض', city: 'الرياض', isDefault: true },
      create: { tenantId, code: 'WH-RIY-01', name: 'Main Warehouse', nameAr: 'المستودع الرئيسي - الرياض', city: 'الرياض', isDefault: true },
    });
    await tx.branch.upsert({
      where: { code_tenantId: { code: 'BR-RIY-01', tenantId } },
      update: { name: 'Main Branch', nameAr: 'الفرع الرئيسي - الرياض', city: 'الرياض', isDefault: true },
      create: { tenantId, code: 'BR-RIY-01', name: 'Main Branch', nameAr: 'الفرع الرئيسي - الرياض', city: 'الرياض', isDefault: true },
    });

    // Saudi chart of accounts (parents first). The seed runs from
    // packages/db/prisma (tsx), so the CoA JSON sits in ./data next to it;
    // the repo-root candidate covers running the compiled seed from dist.
    const candidates = [join(__dirname, 'data', 'saudi-coa.json'), join(process.cwd(), 'packages', 'db', 'prisma', 'data', 'saudi-coa.json')];
    let coaRaw: string | null = null;
    for (const c of candidates) {
      try { coaRaw = readFileSync(c, 'utf-8'); break; } catch { /* try next */ }
    }
    if (!coaRaw) throw new Error('Seed: saudi-coa.json not found (looked in prisma/data and <repo>/packages/db/prisma/data)');
    const coa = JSON.parse(coaRaw) as {
      code: string; nameAr: string; nameEn: string; type: string; parentCode: string | null;
    }[];
    const coaIds = new Map<string, string>();
    for (const pass of [coa.filter((a) => !a.parentCode), coa.filter((a) => a.parentCode)]) {
      for (const a of pass) {
        const row = await tx.chartOfAccounts.upsert({
          where: { code_tenantId: { code: a.code, tenantId } },
          update: { nameAr: a.nameAr, nameEn: a.nameEn, type: a.type, parentId: a.parentCode ? coaIds.get(a.parentCode) ?? null : null, isSystem: true },
          create: { tenantId, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, type: a.type, parentId: a.parentCode ? coaIds.get(a.parentCode) ?? null : null, isSystem: true },
        });
        coaIds.set(a.code, row.id);
      }
    }

    // --- Phase 1 — Master Data (idempotent upserts) ---
    const vat15 = await tx.taxRate.findFirstOrThrow({ where: { tenantId, isDefault: true } });
    const uomPiece = await tx.unitOfMeasure.findFirstOrThrow({ where: { tenantId, code: 'piece' } });
    const uomKg = await tx.unitOfMeasure.findFirstOrThrow({ where: { tenantId, code: 'kg' } });
    const uomLitre = await tx.unitOfMeasure.findFirstOrThrow({ where: { tenantId, code: 'litre' } });
    const uomCarton = await tx.unitOfMeasure.findFirstOrThrow({ where: { tenantId, code: 'carton' } });
    const uomBox = await tx.unitOfMeasure.findFirstOrThrow({ where: { tenantId, code: 'box' } });

    const contacts: {
      type: string; legalName: string; legalNameAr: string; displayName: string;
      taxNumber?: string; commercialRegistration?: string; email?: string; phone?: string;
      city?: string; creditLimitMinor: bigint; paymentTermsDays: number;
    }[] = [
      { type: 'CUSTOMER', legalName: 'Al-Noor Retail Stores', legalNameAr: 'متاجر النور للبيع بالتجزئة', displayName: 'Al-Noor Retail', taxNumber: '300100000000001', commercialRegistration: '1010123456', email: 'sales@alnoor-retail.sa', phone: '+966551234567', city: 'الرياض', creditLimitMinor: 5000000n, paymentTermsDays: 30 },
      { type: 'CUSTOMER', legalName: 'Jeddah Food Markets Co.', legalNameAr: 'شركة أسواق جدة الغذائية', displayName: 'Jeddah Food Markets', taxNumber: '300200000000002', email: 'orders@jeddahfood.sa', phone: '+966551234568', city: 'جدة', creditLimitMinor: 10000000n, paymentTermsDays: 45 },
      { type: 'CUSTOMER', legalName: 'Eastern Province Trading Est.', legalNameAr: 'مؤسسة المنطقة الشرقية للتجارة', displayName: 'Eastern Trading', email: 'info@eastern-trading.sa', phone: '+966551234569', city: 'الدمام', creditLimitMinor: 2500000n, paymentTermsDays: 15 },
      { type: 'CUSTOMER', legalName: 'Makkah Hospitality Supplies', legalNameAr: 'مؤسسة مكة لتموين الضيافة', displayName: 'Makkah Hospitality', taxNumber: '300300000000003', email: 'buy@makkah-hosp.sa', phone: '+966551234570', city: 'مكة المكرمة', creditLimitMinor: 7500000n, paymentTermsDays: 30 },
      { type: 'SUPPLIER', legalName: 'Saudi Grains & Foods Co.', legalNameAr: 'شركة الحبوب والأغذية السعودية', displayName: 'Saudi Grains', taxNumber: '300400000000004', commercialRegistration: '1010654321', email: 'sales@saudigrains.sa', phone: '+966112345679', city: 'الرياض', creditLimitMinor: 0n, paymentTermsDays: 30 },
      { type: 'SUPPLIER', legalName: 'Gulf Electronics Trading', legalNameAr: 'شركة الخليج لتجارة الإلكترونيات', displayName: 'Gulf Electronics', taxNumber: '300500000000005', email: 'b2b@gulfelec.sa', phone: '+966112345680', city: 'الرياض', creditLimitMinor: 0n, paymentTermsDays: 60 },
      { type: 'SUPPLIER', legalName: 'Al-Qassim Dates Farms', legalNameAr: 'مزارع القصيم للتمور', displayName: 'Al-Qassim Dates', email: 'trade@qassimdates.sa', phone: '+966551234571', city: 'بريدة', creditLimitMinor: 0n, paymentTermsDays: 15 },
      { type: 'BOTH', legalName: 'Riyadh Wholesale & Distribution', legalNameAr: 'شركة الرياض للجملة والتوزيع', displayName: 'Riyadh Wholesale', taxNumber: '300600000000006', commercialRegistration: '1010987654', email: 'ops@riyadh-wholesale.sa', phone: '+966112345681', city: 'الرياض', creditLimitMinor: 3000000n, paymentTermsDays: 30 },
    ];
    for (const c of contacts) {
      await tx.contact.upsert({
        where: { email_tenantId: { email: c.email!, tenantId } },
        update: { type: c.type, legalName: c.legalName, legalNameAr: c.legalNameAr, displayName: c.displayName, taxNumber: c.taxNumber ?? null, commercialRegistration: c.commercialRegistration ?? null, phone: c.phone ?? null, city: c.city ?? null, creditLimitMinor: c.creditLimitMinor, paymentTermsDays: c.paymentTermsDays },
        create: { tenantId, type: c.type, legalName: c.legalName, legalNameAr: c.legalNameAr, displayName: c.displayName, taxNumber: c.taxNumber ?? null, commercialRegistration: c.commercialRegistration ?? null, email: c.email ?? null, phone: c.phone ?? null, city: c.city ?? null, country: 'SA', creditLimitMinor: c.creditLimitMinor, creditLimitCurrency: 'SAR', paymentTermsDays: c.paymentTermsDays, status: 'ACTIVE' },
      });
    }

    const categories: { code: string; name: string; nameAr: string; parentCode?: string }[] = [
      { code: 'FOOD', name: 'Foodstuffs', nameAr: 'مواد غذائية' },
      { code: 'BEV', name: 'Beverages', nameAr: 'مشروبات', parentCode: 'FOOD' },
      { code: 'ELEC', name: 'Electronics', nameAr: 'إلكترونيات' },
      { code: 'HOME', name: 'Household', nameAr: 'أدوات منزلية' },
    ];
    const catIds = new Map<string, string>();
    for (const cat of categories) {
      const row = await tx.itemCategory.upsert({
        where: { code_tenantId: { code: cat.code, tenantId } },
        update: { name: cat.name, nameAr: cat.nameAr, parentId: cat.parentCode ? catIds.get(cat.parentCode) ?? null : null },
        create: { tenantId, code: cat.code, name: cat.name, nameAr: cat.nameAr, parentId: cat.parentCode ? catIds.get(cat.parentCode) ?? null : null },
      });
      catIds.set(cat.code, row.id);
    }

    const items: {
      sku: string; name: string; nameAr: string; category: string; uom: string;
      sales: bigint; purchase: bigint; cost: bigint; reorder: bigint;
    }[] = [
      { sku: 'RICE-BAS-5KG', name: 'Basmati Rice 5kg', nameAr: 'أرز بسمتي ٥ كجم', category: 'FOOD', uom: 'kg', sales: 3499n, purchase: 2800n, cost: 2800n, reorder: 50n },
      { sku: 'SUGAR-10KG', name: 'White Sugar 10kg', nameAr: 'سكر أبيض ١٠ كجم', category: 'FOOD', uom: 'kg', sales: 3299n, purchase: 2600n, cost: 2600n, reorder: 40n },
      { sku: 'OIL-OLV-1L', name: 'Olive Oil 1L', nameAr: 'زيت زيتون ١ لتر', category: 'FOOD', uom: 'litre', sales: 4599n, purchase: 3600n, cost: 3600n, reorder: 30n },
      { sku: 'DATES-AJWA-400', name: 'Ajwa Dates 400g', nameAr: 'تمر عجوة ٤٠٠ غ', category: 'FOOD', uom: 'piece', sales: 8999n, purchase: 6500n, cost: 6500n, reorder: 20n },
      { sku: 'TEA-BLK-100', name: 'Black Tea 100 bags', nameAr: 'شاي أسود ١٠٠ كيس', category: 'BEV', uom: 'box', sales: 1499n, purchase: 1000n, cost: 1000n, reorder: 60n },
      { sku: 'TV-LED-55', name: 'LED TV 55 inch', nameAr: 'تلفاز LED ٥٥ بوصة', category: 'ELEC', uom: 'piece', sales: 149999n, purchase: 120000n, cost: 120000n, reorder: 5n },
      { sku: 'AC-SPLIT-18K', name: 'Split Air Conditioner 18000 BTU', nameAr: 'مكيف سبليت ١٨٠٠٠ وحدة', category: 'ELEC', uom: 'piece', sales: 189999n, purchase: 155000n, cost: 155000n, reorder: 5n },
      { sku: 'FRIDGE-14CF', name: 'Refrigerator 14 cu ft', nameAr: 'ثلاجة ١٤ قدم مكعب', category: 'ELEC', uom: 'piece', sales: 219999n, purchase: 180000n, cost: 180000n, reorder: 3n },
      { sku: 'DET-LIQ-3L', name: 'Liquid Detergent 3L', nameAr: 'منظف سائل ٣ لتر', category: 'HOME', uom: 'litre', sales: 2499n, purchase: 1800n, cost: 1800n, reorder: 40n },
      { sku: 'TISSUE-5PK', name: 'Facial Tissue 5-pack', nameAr: 'مناديل ورقية ٥ علب', category: 'HOME', uom: 'carton', sales: 1999n, purchase: 1400n, cost: 1400n, reorder: 50n },
    ];
    const uomByCode: Record<string, string> = { piece: uomPiece.id, kg: uomKg.id, litre: uomLitre.id, carton: uomCarton.id, box: uomBox.id };
    const itemIds = new Map<string, string>();
    for (const it of items) {
      const row = await tx.item.upsert({
        where: { sku_tenantId: { sku: it.sku, tenantId } },
        update: { name: it.name, nameAr: it.nameAr, categoryId: catIds.get(it.category)!, defaultUomId: uomByCode[it.uom]!, taxRateId: vat15.id, salesPriceMinor: it.sales, salesPriceCurrency: 'SAR', purchasePriceMinor: it.purchase, purchasePriceCurrency: 'SAR', standardCostMinor: it.cost, standardCostCurrency: 'SAR', reorderPoint: it.reorder },
        create: { tenantId, sku: it.sku, name: it.name, nameAr: it.nameAr, categoryId: catIds.get(it.category)!, defaultUomId: uomByCode[it.uom]!, taxRateId: vat15.id, costingMethod: 'FIFO', standardCostMinor: it.cost, standardCostCurrency: 'SAR', salesPriceMinor: it.sales, salesPriceCurrency: 'SAR', purchasePriceMinor: it.purchase, purchasePriceCurrency: 'SAR', status: 'ACTIVE', trackStock: true, reorderPoint: it.reorder, minStock: 0n },
      });
      itemIds.set(it.sku, row.id);
    }

    const existingPriceList = await tx.priceList.findFirst({ where: { tenantId, name: 'Standard Retail' } });
    const priceList = existingPriceList
      ? await tx.priceList.update({ where: { id: existingPriceList.id }, data: { nameAr: 'قائمة الأسعار القياسية', currency: 'SAR', isDefault: true } })
      : await tx.priceList.create({ data: { tenantId, name: 'Standard Retail', nameAr: 'قائمة الأسعار القياسية', currency: 'SAR', isDefault: true } });
    // Ensure exactly one default price list per tenant.
    await tx.priceList.updateMany({ where: { tenantId, id: { not: priceList.id } }, data: { isDefault: false } });
    for (const it of items) {
      await tx.priceListItem.upsert({
        where: { priceListId_itemId_minQuantity: { priceListId: priceList.id, itemId: itemIds.get(it.sku)!, minQuantity: 1n } },
        update: { priceMinor: it.sales },
        create: { tenantId, priceListId: priceList.id, itemId: itemIds.get(it.sku)!, priceMinor: it.sales, minQuantity: 1n },
      });
    }

    // --- Phase 2 — Accounting (idempotent) ---
    // Fiscal year 2026: 12 monthly periods. Jan–Sep are CLOSED (history),
    // Oct–Dec OPEN so the sample entries below can post into them. The
    // upsert never overwrites an existing period's status, so re-running
    // the seed cannot reopen a period somebody closed.
    const periodIds = new Map<number, string>();
    for (let m = 1; m <= 12; m++) {
      const start = new Date(Date.UTC(2026, m - 1, 1));
      const end = new Date(Date.UTC(2026, m, 0, 23, 59, 59, 999));
      const row = await tx.fiscalPeriod.upsert({
        where: { tenantId_fiscalYear_periodNumber: { tenantId, fiscalYear: 2026, periodNumber: m } },
        update: {},
        create: { tenantId, fiscalYear: 2026, periodNumber: m, startDate: start, endDate: end, status: m <= 9 ? 'CLOSED' : 'OPEN' },
      });
      periodIds.set(m, row.id);
    }

    const costCenters: { code: string; name: string; nameAr: string }[] = [
      { code: 'HQ', name: 'Head Office', nameAr: 'الإدارة العامة' },
      { code: 'SALES', name: 'Sales', nameAr: 'المبيعات' },
      { code: 'OPS', name: 'Operations', nameAr: 'العمليات' },
    ];
    const ccIds = new Map<string, string>();
    for (const cc of costCenters) {
      const row = await tx.costCenter.upsert({
        where: { code_tenantId: { code: cc.code, tenantId } },
        update: { name: cc.name, nameAr: cc.nameAr },
        create: { tenantId, ...cc, status: 'ACTIVE' },
      });
      ccIds.set(cc.code, row.id);
    }

    // Opening balances for fiscal year 2026 (minor units, halalas).
    // Debits 215,000,000 = credits 215,000,000 (balanced).
    const openingBalances: { code: string; debit: bigint; credit: bigint }[] = [
      { code: '1010', debit: 25000000n, credit: 0n }, // Cash on Hand 250,000.00
      { code: '1020', debit: 125000000n, credit: 0n }, // Banks 1,250,000.00
      { code: '1110', debit: 18000000n, credit: 0n }, // Customers 180,000.00
      { code: '1210', debit: 32000000n, credit: 0n }, // Inventory 320,000.00
      { code: '1410', debit: 15000000n, credit: 0n }, // Equipment 150,000.00
      { code: '2010', debit: 0n, credit: 9500000n }, // Suppliers 95,000.00
      { code: '2110', debit: 0n, credit: 1200000n }, // VAT output 12,000.00
      { code: '3000', debit: 0n, credit: 204300000n }, // Share capital 2,043,000.00
    ];
    for (const ob of openingBalances) {
      const accountId = coaIds.get(ob.code)!;
      await tx.openingBalance.upsert({
        where: { tenantId_accountId_fiscalYear: { tenantId, accountId, fiscalYear: 2026 } },
        update: { debitMinor: ob.debit, creditMinor: ob.credit, currency: 'SAR' },
        create: { tenantId, accountId, fiscalYear: 2026, debitMinor: ob.debit, creditMinor: ob.credit, currency: 'SAR' },
      });
    }

    // Sample journal entries (posted, in OPEN periods Oct/Nov 2026).
    // Amounts are halalas; each entry balances. JE1/JE2 carry the 15% VAT
    // rate on their sales/purchase lines so the VAT summary has real data.
    const acct = (code: string): string => coaIds.get(code)!;
    const sampleEntries: {
      number: string; date: string; period: number; status: string;
      description: string; reference?: string; sourceModule: string;
      lines: { code: string; debit: bigint; credit: bigint; tax?: boolean; cc?: string }[];
    }[] = [
      {
        number: 'JE-2026-00001', date: '2026-10-05', period: 10, status: 'POSTED',
        description: 'Cash sale — merchandise (incl. 15% VAT)', reference: 'POS-1001', sourceModule: 'SALES',
        lines: [
          { code: '1010', debit: 1150000n, credit: 0n },
          { code: '4010', debit: 0n, credit: 1000000n, tax: true, cc: 'SALES' },
          { code: '2110', debit: 0n, credit: 150000n },
        ],
      },
      {
        number: 'JE-2026-00002', date: '2026-10-12', period: 10, status: 'POSTED',
        description: 'Inventory purchase on credit — Saudi Grains (incl. 15% VAT)', reference: 'PO-2026-0041', sourceModule: 'PURCHASING',
        lines: [
          { code: '1210', debit: 5000000n, credit: 0n, tax: true },
          { code: '2120', debit: 750000n, credit: 0n },
          { code: '2010', debit: 0n, credit: 5750000n },
        ],
      },
      {
        number: 'JE-2026-00003', date: '2026-11-03', period: 11, status: 'POSTED',
        description: 'October salaries paid from bank', sourceModule: 'PAYROLL',
        lines: [
          { code: '5210', debit: 4500000n, credit: 0n, cc: 'HQ' },
          { code: '1020', debit: 0n, credit: 4500000n },
        ],
      },
      {
        number: 'JE-2026-00004', date: '2026-11-10', period: 11, status: 'POSTED',
        description: 'November shop rent', reference: 'RENT-NOV-2026', sourceModule: 'MANUAL',
        lines: [
          { code: '5220', debit: 1200000n, credit: 0n, cc: 'HQ' },
          { code: '1020', debit: 0n, credit: 1200000n },
        ],
      },
      {
        number: 'JE-2026-00005', date: '2026-11-18', period: 11, status: 'POSTED',
        description: 'Customer payment received — Al-Noor Retail', reference: 'RCPT-2026-0118', sourceModule: 'SALES',
        lines: [
          { code: '1020', debit: 2300000n, credit: 0n },
          { code: '1110', debit: 0n, credit: 2300000n },
        ],
      },
      {
        number: 'JE-2026-00006', date: '2026-11-20', period: 11, status: 'DRAFT',
        description: 'Draft: marketing campaign expense', sourceModule: 'MANUAL',
        lines: [
          { code: '5230', debit: 300000n, credit: 0n, cc: 'SALES' },
          { code: '1020', debit: 0n, credit: 300000n },
        ],
      },
    ];
    for (const e of sampleEntries) {
      const exists = await tx.journalEntry.findFirst({ where: { tenantId, number: e.number } });
      if (exists) continue;
      const totalDebit = e.lines.reduce((s, l) => s + l.debit, 0n);
      const totalCredit = e.lines.reduce((s, l) => s + l.credit, 0n);
      await tx.journalEntry.create({
        data: {
          tenantId,
          number: e.number,
          entryDate: new Date(`${e.date}T00:00:00.000Z`),
          fiscalPeriodId: periodIds.get(e.period)!,
          status: e.status,
          description: e.description,
          reference: e.reference ?? null,
          sourceModule: e.sourceModule,
          currency: 'SAR',
          totalDebitMinor: totalDebit,
          totalCreditMinor: totalCredit,
          postedAt: e.status === 'POSTED' ? new Date(`${e.date}T12:00:00.000Z`) : null,
          postedBy: e.status === 'POSTED' ? owner.id : null,
          lines: {
            create: e.lines.map((l, i) => ({
              tenantId,
              accountId: acct(l.code),
              debitMinor: l.debit,
              creditMinor: l.credit,
              currency: 'SAR',
              costCenterId: l.cc ? ccIds.get(l.cc)! : null,
              taxRateId: l.tax ? vat15.id : null,
              lineOrder: i,
            })),
          },
        },
      });
    }
    // Keep the JE series counter ahead of the seeded numbers.
    await tx.numberingSeries.updateMany({ where: { tenantId, code: 'JE' }, data: { nextNumber: 7 } });

    // --- Phase 3/4 — Sales + Purchasing demo flow (idempotent) ---
    // Lead -> opportunity (WON) -> quote (ACCEPTED) -> order (CONFIRMED) ->
    // sales invoice (POSTED, partially paid) + customer payment, and
    // purchase order (CONFIRMED) -> supplier invoice (POSTED, partially
    // paid) + supplier payment. Amounts are halalas; VAT 15%.
    //   Sales: 100 x Basmati Rice 5kg @ 34.99 = 349,900 net + 52,485 VAT = 402,385;
    //          paid 200,000 -> balance 202,385 (AR aging: CURRENT, due 2026-12-20).
    //   Purch:  50 x Basmati Rice 5kg @ 28.00 = 140,000 net + 21,000 VAT = 161,000;
    //          paid 100,000 -> balance 61,000 (AP aging: CURRENT, due 2026-12-21).
    const alNoor = await tx.contact.findFirstOrThrow({ where: { tenantId, email: 'sales@alnoor-retail.sa' } });
    const saudiGrains = await tx.contact.findFirstOrThrow({ where: { tenantId, email: 'sales@saudigrains.sa' } });
    const riceId = itemIds.get('RICE-BAS-5KG')!;
    const salesUser = owner;

    let demoLead = await tx.lead.findFirst({ where: { tenantId, email: 'khalid@otaibi-trading.sa' } });
    if (!demoLead) {
      demoLead = await tx.lead.create({
        data: {
          tenantId, name: 'Khalid Al-Otaibi', company: 'Otaibi Trading Est.', email: 'khalid@otaibi-trading.sa',
          phone: '+966551234572', source: 'REFERRAL', status: 'QUALIFIED', notes: 'Referred by Al-Noor Retail; buys rice monthly.',
          expectedValueMinor: 5000000n, expectedValueCurrency: 'SAR', createdBy: salesUser.id,
        },
      });
    }
    let demoOpp = await tx.opportunity.findFirst({ where: { tenantId, title: 'Monthly rice supply — Al-Noor Retail' } });
    if (!demoOpp) {
      demoOpp = await tx.opportunity.create({
        data: {
          tenantId, customerId: alNoor.id, leadId: demoLead.id, title: 'Monthly rice supply — Al-Noor Retail',
          stage: 'WON', probability: 100, expectedValueMinor: 402385n, expectedValueCurrency: 'SAR',
          expectedCloseDate: new Date('2026-11-20T00:00:00.000Z'), ownerId: salesUser.id, createdBy: salesUser.id,
        },
      });
    }

    // Journal entries for the demo postings (JE-2026-00007..00010).
    const demoEntries: {
      number: string; date: string; description: string; reference: string; sourceModule: string;
      lines: { code: string; debit: bigint; credit: bigint; tax?: boolean; cc?: string }[];
    }[] = [
      {
        number: 'JE-2026-00007', date: '2026-11-20', description: 'Sales invoice INV-2026-00001 — Al-Noor Retail', reference: 'INV-2026-00001', sourceModule: 'SALES',
        lines: [
          { code: '1110', debit: 402385n, credit: 0n },
          { code: '4010', debit: 0n, credit: 349900n, tax: true, cc: 'SALES' },
          { code: '2110', debit: 0n, credit: 52485n },
        ],
      },
      {
        number: 'JE-2026-00008', date: '2026-11-22', description: 'Customer payment PAY-2026-00001 — Al-Noor Retail', reference: 'PAY-2026-00001', sourceModule: 'SALES',
        lines: [
          { code: '1020', debit: 200000n, credit: 0n },
          { code: '1110', debit: 0n, credit: 200000n },
        ],
      },
      {
        number: 'JE-2026-00009', date: '2026-11-21', description: 'Supplier invoice SIN-2026-00001 — Saudi Grains', reference: 'SIN-2026-00001', sourceModule: 'PURCHASING',
        lines: [
          { code: '5100', debit: 140000n, credit: 0n, tax: true },
          { code: '2120', debit: 21000n, credit: 0n },
          { code: '2010', debit: 0n, credit: 161000n },
        ],
      },
      {
        number: 'JE-2026-00010', date: '2026-11-23', description: 'Supplier payment SPAY-2026-00001 — Saudi Grains', reference: 'SPAY-2026-00001', sourceModule: 'PURCHASING',
        lines: [
          { code: '2010', debit: 100000n, credit: 0n },
          { code: '1020', debit: 0n, credit: 100000n },
        ],
      },
      // Phase 5 — goods receipt (30 x rice @ 28.00 = 84,000) into GRNI.
      {
        number: 'JE-2026-00011', date: '2026-11-24', description: 'Goods receipt GRN-2026-00001 — Saudi Grains', reference: 'GRN-2026-00001', sourceModule: 'INVENTORY',
        lines: [
          { code: '1210', debit: 84000n, credit: 0n },
          { code: '2020', debit: 0n, credit: 84000n },
        ],
      },
      // Phase 5 — delivery note (20 x rice @ 28.00 COGS = 56,000).
      {
        number: 'JE-2026-00012', date: '2026-11-24', description: 'Delivery note DN-2026-00001 — Al-Noor Retail', reference: 'DN-2026-00001', sourceModule: 'INVENTORY',
        lines: [
          { code: '5010', debit: 56000n, credit: 0n },
          { code: '1210', debit: 0n, credit: 56000n },
        ],
      },
      // Phase 5 — stock adjustment, damage: 2 x rice @ 28.00 = 5,600.
      {
        number: 'JE-2026-00013', date: '2026-11-24', description: 'Stock adjustment ADJ-2026-00001 — damaged rice', reference: 'ADJ-2026-00001', sourceModule: 'INVENTORY',
        lines: [
          { code: '5240', debit: 5600n, credit: 0n },
          { code: '1210', debit: 0n, credit: 5600n },
        ],
      },
      // Phase 6 — POS sale 1: 2 x rice @ 34.99 cash (net 6,998 + VAT 1,050 = 8,048; COGS 5,600).
      {
        number: 'JE-2026-00014', date: '2026-11-24', description: 'POS sale POS-2026-00001 — terminal POS-RIY-01', reference: 'POS-2026-00001', sourceModule: 'POS',
        lines: [
          { code: '1010', debit: 8048n, credit: 0n },
          { code: '5010', debit: 5600n, credit: 0n },
          { code: '4010', debit: 0n, credit: 6998n, tax: true, cc: 'SALES' },
          { code: '2110', debit: 0n, credit: 1050n },
          { code: '1210', debit: 0n, credit: 5600n },
        ],
      },
      // Phase 6 — POS sale 2: 1 x rice @ 34.99 by card (net 3,499 + VAT 525 = 4,024; COGS 2,800).
      {
        number: 'JE-2026-00015', date: '2026-11-24', description: 'POS sale POS-2026-00002 — terminal POS-RIY-01', reference: 'POS-2026-00002', sourceModule: 'POS',
        lines: [
          { code: '1030', debit: 4024n, credit: 0n },
          { code: '5010', debit: 2800n, credit: 0n },
          { code: '4010', debit: 0n, credit: 3499n, tax: true, cc: 'SALES' },
          { code: '2110', debit: 0n, credit: 525n },
          { code: '1210', debit: 0n, credit: 2800n },
        ],
      },
      // Phase 7 — material issue MI-2026-00001 (21 dates @ 65.00 + 10 tea @ 10.00
      // + 10 tissue @ 14.00 = 160,500) into WIP.
      {
        number: 'JE-2026-00016', date: '2026-11-24', description: 'Material issue MI-2026-00001 — work order WO-2026-00001', reference: 'MI-2026-00001', sourceModule: 'MANUFACTURING',
        lines: [
          { code: '1220', debit: 160500n, credit: 0n },
          { code: '1210', debit: 0n, credit: 160500n },
        ],
      },
      // Phase 7 — production receipt PR-2026-00001 (6 gift boxes @ 160.50 = 96,300).
      {
        number: 'JE-2026-00017', date: '2026-11-24', description: 'Production receipt PR-2026-00001 — work order WO-2026-00001', reference: 'PR-2026-00001', sourceModule: 'MANUFACTURING',
        lines: [
          { code: '1230', debit: 96300n, credit: 0n },
          { code: '1220', debit: 0n, credit: 96300n },
        ],
      },
      // Phase 7 — finished scrap SCR-2026-00001 (1 gift box @ 160.50 = 16,050).
      {
        number: 'JE-2026-00018', date: '2026-11-24', description: 'Scrap SCR-2026-00001 — work order WO-2026-00001', reference: 'SCR-2026-00001', sourceModule: 'MANUFACTURING',
        lines: [
          { code: '5260', debit: 16050n, credit: 0n },
          { code: '1220', debit: 0n, credit: 16050n },
        ],
      },
    ];
    const demoJeIds = new Map<string, string>();
    for (const e of demoEntries) {
      const existing = await tx.journalEntry.findFirst({ where: { tenantId, number: e.number } });
      if (existing) { demoJeIds.set(e.number, existing.id); continue; }
      const created = await tx.journalEntry.create({
        data: {
          tenantId, number: e.number, entryDate: new Date(`${e.date}T00:00:00.000Z`),
          fiscalPeriodId: periodIds.get(11)!, status: 'POSTED', description: e.description,
          reference: e.reference, sourceModule: e.sourceModule, currency: 'SAR',
          totalDebitMinor: e.lines.reduce((s, l) => s + l.debit, 0n),
          totalCreditMinor: e.lines.reduce((s, l) => s + l.credit, 0n),
          postedAt: new Date(`${e.date}T12:00:00.000Z`), postedBy: salesUser.id,
          lines: {
            create: e.lines.map((l, i) => ({
              tenantId, accountId: acct(l.code), debitMinor: l.debit, creditMinor: l.credit, currency: 'SAR',
              costCenterId: l.cc ? ccIds.get(l.cc)! : null, taxRateId: l.tax ? vat15.id : null, lineOrder: i,
            })),
          },
        },
      });
      demoJeIds.set(e.number, created.id);
    }

    let demoOrder = await tx.salesOrder.findFirst({ where: { tenantId, number: 'SO-2026-00001' } });
    if (!demoOrder) {
      demoOrder = await tx.salesOrder.create({
        data: {
          tenantId, number: 'SO-2026-00001', customerId: alNoor.id, status: 'CONFIRMED', currency: 'SAR',
          subtotalMinor: 349900n, discountMinor: 0n, taxMinor: 52485n, totalMinor: 402385n, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, itemId: riceId, quantityOrdered: 100n, quantityFulfilled: 0n, unitPriceMinor: 3499n,
              discountPct: 0, taxRateBps: 1500, lineSubtotalMinor: 349900n, lineDiscountMinor: 0n,
              lineTaxMinor: 52485n, lineTotalMinor: 402385n, lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
      });
    }
    let demoQuote = await tx.salesQuote.findFirst({ where: { tenantId, number: 'QUO-2026-00001' } });
    if (!demoQuote) {
      demoQuote = await tx.salesQuote.create({
        data: {
          tenantId, number: 'QUO-2026-00001', customerId: alNoor.id, salesOrderId: demoOrder.id,
          validFrom: new Date('2026-11-15T00:00:00.000Z'), validTo: new Date('2026-12-15T00:00:00.000Z'),
          status: 'ACCEPTED', currency: 'SAR', subtotalMinor: 349900n, discountMinor: 0n, taxMinor: 52485n,
          totalMinor: 402385n, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, itemId: riceId, quantity: 100n, unitPriceMinor: 3499n, discountPct: 0, taxRateBps: 1500,
              lineSubtotalMinor: 349900n, lineDiscountMinor: 0n, lineTaxMinor: 52485n, lineTotalMinor: 402385n,
              lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
      });
    }
    // Link the order back to its quote.
    await tx.salesOrder.update({ where: { id: demoOrder.id }, data: { quoteId: demoQuote.id } });

    let demoSalesInvoice = await tx.salesInvoice.findFirst({ where: { tenantId, number: 'INV-2026-00001' } });
    if (!demoSalesInvoice) {
      demoSalesInvoice = await tx.salesInvoice.create({
        data: {
          tenantId, number: 'INV-2026-00001', type: 'INVOICE', customerId: alNoor.id, orderId: demoOrder.id,
          status: 'POSTED', currency: 'SAR', invoiceDate: new Date('2026-11-20T00:00:00.000Z'),
          dueDate: new Date('2026-12-20T00:00:00.000Z'), subtotalMinor: 349900n, discountMinor: 0n,
          taxMinor: 52485n, totalMinor: 402385n, paidMinor: 200000n,
          journalEntryId: demoJeIds.get('JE-2026-00007')!, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, itemId: riceId, quantity: 100n, unitPriceMinor: 3499n, discountPct: 0, taxRateBps: 1500,
              lineSubtotalMinor: 349900n, lineDiscountMinor: 0n, lineTaxMinor: 52485n, lineTotalMinor: 402385n,
              lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
      });
    }
    const existingCustPay = await tx.customerPayment.findFirst({ where: { tenantId, number: 'PAY-2026-00001' } });
    if (!existingCustPay) {
      await tx.customerPayment.create({
        data: {
          tenantId, number: 'PAY-2026-00001', customerId: alNoor.id, method: 'BANK_TRANSFER',
          reference: 'TRF-2026-1122', paymentDate: new Date('2026-11-22T00:00:00.000Z'), currency: 'SAR',
          amountMinor: 200000n, journalEntryId: demoJeIds.get('JE-2026-00008')!, createdBy: salesUser.id,
          allocations: { create: [{ tenantId, invoiceId: demoSalesInvoice.id, amountMinor: 200000n, createdBy: salesUser.id }] },
        },
      });
      // PARTIALLY_PAID: 200,000 of 402,385 paid.
      await tx.salesInvoice.update({ where: { id: demoSalesInvoice.id }, data: { status: 'PARTIALLY_PAID' } });
    }

    let demoPo = await tx.purchaseOrder.findFirst({ where: { tenantId, number: 'PO-2026-00001' } });
    if (!demoPo) {
      demoPo = await tx.purchaseOrder.create({
        data: {
          tenantId, number: 'PO-2026-00001', supplierId: saudiGrains.id, status: 'CONFIRMED', currency: 'SAR',
          expectedDate: new Date('2026-11-25T00:00:00.000Z'), subtotalMinor: 140000n, discountMinor: 0n,
          taxMinor: 21000n, totalMinor: 161000n, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, itemId: riceId, quantityOrdered: 50n, quantityReceived: 0n, unitCostMinor: 2800n,
              discountPct: 0, taxRateBps: 1500, lineSubtotalMinor: 140000n, lineDiscountMinor: 0n,
              lineTaxMinor: 21000n, lineTotalMinor: 161000n, lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
        include: { lines: true },
      });
    } else {
      demoPo = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: demoPo.id }, include: { lines: true } });
    }
    let demoSupInvoice = await tx.supplierInvoice.findFirst({ where: { tenantId, number: 'SIN-2026-00001' } });
    if (!demoSupInvoice) {
      const demoPoLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: demoPo.id }, orderBy: { lineOrder: 'asc' } });
      demoSupInvoice = await tx.supplierInvoice.create({
        data: {
          tenantId, number: 'SIN-2026-00001', supplierId: saudiGrains.id, purchaseOrderId: demoPo.id,
          status: 'POSTED', currency: 'SAR', invoiceDate: new Date('2026-11-21T00:00:00.000Z'),
          dueDate: new Date('2026-12-21T00:00:00.000Z'), subtotalMinor: 140000n, discountMinor: 0n,
          taxMinor: 21000n, totalMinor: 161000n, paidMinor: 100000n,
          journalEntryId: demoJeIds.get('JE-2026-00009')!, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, itemId: riceId, quantity: 50n, unitCostMinor: 2800n, discountPct: 0, taxRateBps: 1500,
              purchaseOrderLineId: demoPoLines[0].id,
              lineSubtotalMinor: 140000n, lineDiscountMinor: 0n, lineTaxMinor: 21000n, lineTotalMinor: 161000n,
              lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
      });
    }
    const existingSupPay = await tx.supplierPayment.findFirst({ where: { tenantId, number: 'SPAY-2026-00001' } });
    if (!existingSupPay) {
      await tx.supplierPayment.create({
        data: {
          tenantId, number: 'SPAY-2026-00001', supplierId: saudiGrains.id, method: 'BANK_TRANSFER',
          reference: 'TRF-2026-1123', paymentDate: new Date('2026-11-23T00:00:00.000Z'), currency: 'SAR',
          amountMinor: 100000n, journalEntryId: demoJeIds.get('JE-2026-00010')!, createdBy: salesUser.id,
          allocations: { create: [{ tenantId, invoiceId: demoSupInvoice.id, amountMinor: 100000n, createdBy: salesUser.id }] },
        },
      });
      await tx.supplierInvoice.update({ where: { id: demoSupInvoice.id }, data: { status: 'PARTIALLY_PAID' } });
    }

    // --- Phase 5/6 — Inventory + POS demo flow (idempotent) ---
    // GRN receives 30 of the 50 demo-PO rice into WH-RIY-01 (PO ->
    // PARTIALLY_RECEIVED); the delivery note fulfils 20 of the 100 demo-SO
    // rice (SO -> PARTIALLY_FULFILLED, reservation 100 -> 80); a damage
    // adjustment removes 2; POS sells 3 more. Final rice stock in
    // WH-RIY-01: on hand 5, reserved 80, available -75, average cost 2,800.
    // (The demo supplier invoice SIN-2026-00001 still has no receipt, so
    // its Phase 4 posting — Dr purchases — is unchanged; the GRNI relief
    // only applies to invoices posted after a receipt exists.)
    const whRiyadh = await tx.warehouse.findFirstOrThrow({ where: { tenantId, code: 'WH-RIY-01' } });
    const brRiyadh = await tx.branch.findFirstOrThrow({ where: { tenantId, code: 'BR-RIY-01' } });
    const demoPoLine = (await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: demoPo.id }, orderBy: { lineOrder: 'asc' } }))[0];
    const demoOrderLine = (await tx.orderLine.findMany({ where: { orderId: demoOrder.id }, orderBy: { lineOrder: 'asc' } }))[0];

    const existingGrn = await tx.goodsReceipt.findFirst({ where: { tenantId, number: 'GRN-2026-00001' } });
    if (!existingGrn) {
      const grn = await tx.goodsReceipt.create({
        data: {
          tenantId, number: 'GRN-2026-00001', purchaseOrderId: demoPo.id, warehouseId: whRiyadh.id,
          status: 'POSTED', receiptDate: new Date('2026-11-24T00:00:00.000Z'), currency: 'SAR',
          subtotalMinor: 84000n, totalCostMinor: 84000n,
          journalEntryId: demoJeIds.get('JE-2026-00011')!, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, purchaseOrderLineId: demoPoLine.id, itemId: riceId, quantityReceived: 30n,
              unitCostMinor: 2800n, lineTotalMinor: 84000n, lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
        include: { lines: true },
      });
      await tx.purchaseOrderLine.update({ where: { id: demoPoLine.id }, data: { quantityReceived: 30n } });
      await tx.purchaseOrder.update({ where: { id: demoPo.id }, data: { status: 'PARTIALLY_RECEIVED' } });

      const dn = await tx.deliveryNote.create({
        data: {
          tenantId, number: 'DN-2026-00001', salesOrderId: demoOrder.id, warehouseId: whRiyadh.id,
          status: 'POSTED', deliveryDate: new Date('2026-11-24T00:00:00.000Z'), currency: 'SAR',
          totalCostMinor: 56000n, journalEntryId: demoJeIds.get('JE-2026-00012')!, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, salesOrderLineId: demoOrderLine.id, itemId: riceId, quantity: 20n,
              unitCostMinor: 2800n, lineTotalMinor: 56000n, lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
        include: { lines: true },
      });
      await tx.orderLine.update({ where: { id: demoOrderLine.id }, data: { quantityFulfilled: 20n } });
      await tx.salesOrder.update({ where: { id: demoOrder.id }, data: { status: 'PARTIALLY_FULFILLED' } });

      const adj = await tx.stockAdjustment.create({
        data: {
          tenantId, number: 'ADJ-2026-00001', warehouseId: whRiyadh.id, status: 'POSTED',
          adjustmentDate: new Date('2026-11-24T00:00:00.000Z'), currency: 'SAR',
          totalValueMinor: -5600n, journalEntryId: demoJeIds.get('JE-2026-00013')!, createdBy: salesUser.id,
          lines: {
            create: [{
              tenantId, itemId: riceId, quantityDelta: -2n, unitCostMinor: 2800n,
              lineTotalMinor: -5600n, reason: 'DAMAGE', lineOrder: 0, createdBy: salesUser.id,
            }],
          },
        },
        include: { lines: true },
      });

      // One FIFO layer (30 received, 25 consumed) + the resulting level.
      await tx.stockCostLayer.create({
        data: {
          tenantId, warehouseId: whRiyadh.id, itemId: riceId, sourceType: 'GOODS_RECEIPT',
          sourceId: grn.lines[0].id, quantityRemaining: 5n, unitCostMinor: 2800n, currency: 'SAR',
          receivedAt: new Date('2026-11-24T00:00:00.000Z'), createdBy: salesUser.id,
        },
      });
      await tx.stockLevel.create({
        data: {
          tenantId, warehouseId: whRiyadh.id, itemId: riceId, qtyOnHand: 5n, qtyReserved: 80n,
          averageCostMinor: 2800n, lastCostMinor: 2800n, currency: 'SAR', createdBy: salesUser.id,
        },
      });
      const movements: { type: string; sourceType: string; sourceId: string; quantity: bigint; unitCostMinor: bigint; totalCostMinor: bigint; journalEntryId: string; reference: string }[] = [
        { type: 'IN', sourceType: 'GOODS_RECEIPT', sourceId: grn.lines[0].id, quantity: 30n, unitCostMinor: 2800n, totalCostMinor: 84000n, journalEntryId: demoJeIds.get('JE-2026-00011')!, reference: 'GRN-2026-00001' },
        { type: 'OUT', sourceType: 'DELIVERY_NOTE', sourceId: dn.lines[0].id, quantity: 20n, unitCostMinor: 2800n, totalCostMinor: 56000n, journalEntryId: demoJeIds.get('JE-2026-00012')!, reference: 'DN-2026-00001' },
        { type: 'ADJUSTMENT', sourceType: 'ADJUSTMENT', sourceId: adj.lines[0].id, quantity: 2n, unitCostMinor: 2800n, totalCostMinor: 5600n, journalEntryId: demoJeIds.get('JE-2026-00013')!, reference: 'ADJ-2026-00001' },
      ];
      for (const m of movements) {
        await tx.stockMovement.create({
          data: {
            tenantId, type: m.type, itemId: riceId, warehouseId: whRiyadh.id,
            quantity: m.quantity, unitCostMinor: m.unitCostMinor, totalCostMinor: m.totalCostMinor,
            currency: 'SAR', sourceType: m.sourceType, sourceId: m.sourceId, reference: m.reference,
            movementDate: new Date('2026-11-24T00:00:00.000Z'), journalEntryId: m.journalEntryId, createdBy: salesUser.id,
          },
        });
      }
    }

    // --- Phase 6 — POS demo: terminal + one closed shift (2 sales) + one open shift ---
    const terminal = await tx.posTerminal.upsert({
      where: { code_tenantId: { code: 'POS-RIY-01', tenantId } },
      update: { name: 'Riyadh Counter 1', branchId: brRiyadh.id, warehouseId: whRiyadh.id, status: 'ACTIVE', cashAccountCode: '1010', cardAccountCode: '1030' },
      create: { tenantId, code: 'POS-RIY-01', name: 'Riyadh Counter 1', branchId: brRiyadh.id, warehouseId: whRiyadh.id, status: 'ACTIVE', cashAccountCode: '1010', cardAccountCode: '1030', createdBy: salesUser.id },
    });
    let closedShift = await tx.posShift.findFirst({ where: { tenantId, terminalId: terminal.id, status: 'CLOSED' } });
    if (!closedShift) {
      closedShift = await tx.posShift.create({
        data: {
          tenantId, terminalId: terminal.id, cashierId: salesUser.id,
          openedAt: new Date('2026-11-24T09:00:00.000Z'), openingFloatMinor: 50000n, status: 'CLOSED',
          closedAt: new Date('2026-11-24T18:00:00.000Z'), expectedCashMinor: 58048n, expectedCardMinor: 4024n,
          countedCashMinor: 58048n, varianceMinor: 0n, closedBy: salesUser.id, createdBy: salesUser.id,
        },
      });
      const posSales: { number: string; je: string; qty: bigint; cash: bigint; card: bigint; net: bigint; tax: bigint; total: bigint; cogs: bigint }[] = [
        { number: 'POS-2026-00001', je: 'JE-2026-00014', qty: 2n, cash: 8048n, card: 0n, net: 6998n, tax: 1050n, total: 8048n, cogs: 5600n },
        { number: 'POS-2026-00002', je: 'JE-2026-00015', qty: 1n, cash: 0n, card: 4024n, net: 3499n, tax: 525n, total: 4024n, cogs: 2800n },
      ];
      for (const s of posSales) {
        const sale = await tx.posSale.create({
          data: {
            tenantId, number: s.number, terminalId: terminal.id, shiftId: closedShift.id, cashierId: salesUser.id,
            status: 'COMPLETED', saleDate: new Date('2026-11-24T12:00:00.000Z'), currency: 'SAR',
            subtotalMinor: s.net, discountMinor: 0n, taxMinor: s.tax, totalMinor: s.total,
            cashMinor: s.cash, cardMinor: s.card, cogsMinor: s.cogs,
            journalEntryId: demoJeIds.get(s.je)!, createdBy: salesUser.id,
            lines: {
              create: [{
                tenantId, itemId: riceId, quantity: s.qty, unitPriceMinor: 3499n, discountPct: 0, taxRateBps: 1500,
                unitCostMinor: 2800n, lineSubtotalMinor: s.net, lineDiscountMinor: 0n, lineTaxMinor: s.tax,
                lineTotalMinor: s.total, lineOrder: 0, createdBy: salesUser.id,
              }],
            },
            payments: {
              create: s.cash > 0n
                ? [{ tenantId, method: 'CASH', amountMinor: s.cash, createdBy: salesUser.id }]
                : [{ tenantId, method: 'CARD', amountMinor: s.card, createdBy: salesUser.id }],
            },
          },
        });
        await tx.stockMovement.create({
          data: {
            tenantId, type: 'OUT', itemId: riceId, warehouseId: whRiyadh.id, quantity: s.qty,
            unitCostMinor: 2800n, totalCostMinor: s.cogs, currency: 'SAR', sourceType: 'POS_SALE',
            sourceId: sale.id, reference: s.number, movementDate: new Date('2026-11-24T12:00:00.000Z'),
            journalEntryId: demoJeIds.get(s.je)!, createdBy: salesUser.id,
          },
        });
      }
    }
    const openShift = await tx.posShift.findFirst({ where: { tenantId, terminalId: terminal.id, status: 'OPEN' } });
    if (!openShift) {
      await tx.posShift.create({
        data: {
          tenantId, terminalId: terminal.id, cashierId: salesUser.id,
          openedAt: new Date('2026-11-24T18:30:00.000Z'), openingFloatMinor: 50000n, status: 'OPEN',
          createdBy: salesUser.id,
        },
      });
    }

    // --- Phase 7 — Manufacturing demo: dates gift-box BOM + work order ---
    // Finished item GIFT-DATES-BOX ("Dates Gift Box"): BOM v1 (ACTIVE) =
    // 2 x Ajwa Dates 400g (5% scrap) + 1 x Black Tea + 1 x Tissue.
    // Roll-up standard cost = 2 x 6,500 x 1.05 + 1,000 + 1,400 = 16,050.
    // WO-2026-00001 (RELEASED -> IN_PROGRESS, 10 planned): issue MI-2026-00001
    // (21 dates + 10 tea + 10 tissue = 160,500 into WIP), receipt
    // PR-2026-00001 (6 boxes @ 16,050 = 96,300), scrap SCR-2026-00001
    // (1 finished box @ 16,050). WIP balance 48,150, completion 60%.
    // Component opening stock is seeded directly (levels + FIFO layers +
    // IN movements, reference SEED-OPENING-STOCK, no journal entry — the
    // demo opening balances already carry the 1210 lump sum).
    const giftBox = await tx.item.upsert({
      where: { sku_tenantId: { sku: 'GIFT-DATES-BOX', tenantId } },
      update: { name: 'Dates Gift Box', nameAr: 'علبة تمر هدية', standardCostMinor: 16050n, salesPriceMinor: 24999n, purchasePriceMinor: 16050n },
      create: {
        tenantId, sku: 'GIFT-DATES-BOX', name: 'Dates Gift Box', nameAr: 'علبة تمر هدية',
        categoryId: catIds.get('FOOD')!, defaultUomId: uomPiece.id, taxRateId: vat15.id,
        costingMethod: 'FIFO', standardCostMinor: 16050n, standardCostCurrency: 'SAR',
        salesPriceMinor: 24999n, salesPriceCurrency: 'SAR', purchasePriceMinor: 16050n,
        purchasePriceCurrency: 'SAR', status: 'ACTIVE', trackStock: true, reorderPoint: 10n, minStock: 0n,
      },
    });
    const datesId = itemIds.get('DATES-AJWA-400')!;
    const teaId = itemIds.get('TEA-BLK-100')!;
    const tissueId = itemIds.get('TISSUE-5PK')!;
    const packCenter = await tx.workCenter.upsert({
      where: { code_tenantId: { code: 'WC-PACK-01', tenantId } },
      update: { name: 'Packing Line 1', nameAr: 'خط التغليف ١', standardCostRateMinor: 5000n, status: 'ACTIVE' },
      create: { tenantId, code: 'WC-PACK-01', name: 'Packing Line 1', nameAr: 'خط التغليف ١', standardCostRateMinor: 5000n, status: 'ACTIVE', createdBy: salesUser.id },
    });
    let demoBom: Prisma.BomGetPayload<{ include: { lines: true } }> | null = await tx.bom.findFirst({ where: { tenantId, finishedItemId: giftBox.id, version: 1 }, include: { lines: true } });
    if (!demoBom) {
      demoBom = await tx.bom.create({
        data: {
          tenantId, finishedItemId: giftBox.id, version: 1, status: 'ACTIVE',
          name: 'Dates Gift Box — v1', notes: 'Demo BOM: 2 Ajwa dates (5% scrap) + tea + tissue.', createdBy: salesUser.id,
          lines: {
            create: [
              { tenantId, componentItemId: datesId, quantityPerUnit: 2n, scrapBps: 500, workCenterId: packCenter.id, operationName: 'Packing', lineOrder: 0, createdBy: salesUser.id },
              { tenantId, componentItemId: teaId, quantityPerUnit: 1n, scrapBps: 0, workCenterId: packCenter.id, operationName: 'Packing', lineOrder: 1, createdBy: salesUser.id },
              { tenantId, componentItemId: tissueId, quantityPerUnit: 1n, scrapBps: 0, workCenterId: packCenter.id, operationName: 'Packing', lineOrder: 2, createdBy: salesUser.id },
            ],
          },
        },
        include: { lines: true },
      });
    } else {
      demoBom = await tx.bom.findUniqueOrThrow({ where: { id: demoBom.id }, include: { lines: true } });
    }
    const existingWo = await tx.workOrder.findFirst({ where: { tenantId, number: 'WO-2026-00001' } });
    if (!existingWo) {
      // Opening stock for the three components (before the issue).
      const opening: { itemId: string; qty: bigint; cost: bigint }[] = [
        { itemId: datesId, qty: 50n, cost: 6500n },
        { itemId: teaId, qty: 30n, cost: 1000n },
        { itemId: tissueId, qty: 20n, cost: 1400n },
      ];
      const issued: { itemId: string; qty: bigint; cost: bigint }[] = [
        { itemId: datesId, qty: 21n, cost: 6500n },
        { itemId: teaId, qty: 10n, cost: 1000n },
        { itemId: tissueId, qty: 10n, cost: 1400n },
      ];
      for (const o of opening) {
        const used = issued.find((i) => i.itemId === o.itemId)!;
        await tx.stockLevel.create({
          data: { tenantId, warehouseId: whRiyadh.id, itemId: o.itemId, qtyOnHand: o.qty - used.qty, qtyReserved: 0n, averageCostMinor: o.cost, lastCostMinor: o.cost, currency: 'SAR', createdBy: salesUser.id },
        });
        await tx.stockCostLayer.create({
          data: { tenantId, warehouseId: whRiyadh.id, itemId: o.itemId, sourceType: 'ADJUSTMENT', sourceId: null, quantityRemaining: o.qty - used.qty, unitCostMinor: o.cost, currency: 'SAR', receivedAt: new Date('2026-11-24T00:00:00.000Z'), createdBy: salesUser.id },
        });
        await tx.stockMovement.create({
          data: { tenantId, type: 'IN', itemId: o.itemId, warehouseId: whRiyadh.id, quantity: o.qty, unitCostMinor: o.cost, totalCostMinor: o.qty * o.cost, currency: 'SAR', sourceType: 'ADJUSTMENT', sourceId: null, reference: 'SEED-OPENING-STOCK', movementDate: new Date('2026-11-24T00:00:00.000Z'), createdBy: salesUser.id },
        });
      }
      const wo = await tx.workOrder.create({
        data: {
          tenantId, number: 'WO-2026-00001', finishedItemId: giftBox.id, bomId: demoBom.id, bomVersion: 1,
          warehouseId: whRiyadh.id, status: 'IN_PROGRESS', qtyPlanned: 10n, qtyProduced: 6n, qtyScrapped: 1n,
          plannedStartDate: new Date('2026-11-24T00:00:00.000Z'), dueDate: new Date('2026-11-30T00:00:00.000Z'),
          currency: 'SAR', materialCostPlannedMinor: 160500n, materialCostActualMinor: 160500n, unitCostMinor: 16050n,
          notes: 'Demo work order: 10 dates gift boxes.', createdBy: salesUser.id,
          lines: {
            create: demoBom.lines.map((l) => ({
              tenantId, componentItemId: l.componentItemId, quantityPerUnit: BigInt(l.quantityPerUnit),
              scrapBps: l.scrapBps, workCenterId: l.workCenterId, operationName: l.operationName,
              qtyRequired: l.componentItemId === datesId ? 21n : 10n,
              qtyIssued: l.componentItemId === datesId ? 21n : 10n,
              unitCostMinor: l.componentItemId === datesId ? 6500n : l.componentItemId === teaId ? 1000n : 1400n,
              lineOrder: l.lineOrder, createdBy: salesUser.id,
            })),
          },
          operations: {
            create: [{ tenantId, name: 'Packing', workCenterId: packCenter.id, plannedHours: 8, actualHours: 5, status: 'IN_PROGRESS', createdBy: salesUser.id }],
          },
        },
        include: { lines: true },
      });
      const woLineByItem = new Map(wo.lines.map((l) => [l.componentItemId, l.id]));
      const mi = await tx.materialIssue.create({
        data: {
          tenantId, number: 'MI-2026-00001', workOrderId: wo.id, warehouseId: whRiyadh.id,
          status: 'POSTED', issueDate: new Date('2026-11-24T00:00:00.000Z'), currency: 'SAR',
          totalCostMinor: 160500n, journalEntryId: demoJeIds.get('JE-2026-00016')!, createdBy: salesUser.id,
          lines: {
            create: issued.map((i, idx) => ({
              tenantId, workOrderLineId: woLineByItem.get(i.itemId)!, itemId: i.itemId,
              quantity: i.qty, unitCostMinor: i.cost, lineTotalMinor: i.qty * i.cost, lineOrder: idx, createdBy: salesUser.id,
            })),
          },
        },
        include: { lines: true },
      });
      for (const line of mi.lines) {
        await tx.stockMovement.create({
          data: { tenantId, type: 'OUT', itemId: line.itemId, warehouseId: whRiyadh.id, quantity: line.quantity, unitCostMinor: line.unitCostMinor, totalCostMinor: line.lineTotalMinor, currency: 'SAR', sourceType: 'MATERIAL_ISSUE', sourceId: line.id, reference: 'MI-2026-00001', movementDate: new Date('2026-11-24T00:00:00.000Z'), journalEntryId: demoJeIds.get('JE-2026-00016')!, createdBy: salesUser.id },
        });
      }
      const pr = await tx.productionReceipt.create({
        data: {
          tenantId, number: 'PR-2026-00001', workOrderId: wo.id, warehouseId: whRiyadh.id,
          status: 'POSTED', receiptDate: new Date('2026-11-24T00:00:00.000Z'), quantity: 6n,
          unitCostMinor: 16050n, totalCostMinor: 96300n, overProduced: false, currency: 'SAR',
          journalEntryId: demoJeIds.get('JE-2026-00017')!, createdBy: salesUser.id,
        },
      });
      await tx.stockLevel.create({
        data: { tenantId, warehouseId: whRiyadh.id, itemId: giftBox.id, qtyOnHand: 6n, qtyReserved: 0n, averageCostMinor: 16050n, lastCostMinor: 16050n, currency: 'SAR', createdBy: salesUser.id },
      });
      await tx.stockCostLayer.create({
        data: { tenantId, warehouseId: whRiyadh.id, itemId: giftBox.id, sourceType: 'PRODUCTION_RECEIPT', sourceId: pr.id, quantityRemaining: 6n, unitCostMinor: 16050n, currency: 'SAR', receivedAt: new Date('2026-11-24T00:00:00.000Z'), createdBy: salesUser.id },
      });
      await tx.stockMovement.create({
        data: { tenantId, type: 'IN', itemId: giftBox.id, warehouseId: whRiyadh.id, quantity: 6n, unitCostMinor: 16050n, totalCostMinor: 96300n, currency: 'SAR', sourceType: 'PRODUCTION_RECEIPT', sourceId: pr.id, reference: 'PR-2026-00001', movementDate: new Date('2026-11-24T00:00:00.000Z'), journalEntryId: demoJeIds.get('JE-2026-00017')!, createdBy: salesUser.id },
      });
      await tx.scrap.create({
        data: {
          tenantId, number: 'SCR-2026-00001', workOrderId: wo.id, kind: 'FINISHED', itemId: giftBox.id,
          warehouseId: whRiyadh.id, quantity: 1n, unitCostMinor: 16050n, totalCostMinor: 16050n,
          reason: 'Damaged during packing', scrapDate: new Date('2026-11-24T00:00:00.000Z'),
          status: 'POSTED', currency: 'SAR', journalEntryId: demoJeIds.get('JE-2026-00018')!, createdBy: salesUser.id,
        },
      });
    }

    // --- Phase 8 — HR / Payroll demo ---
    // Departments ADM (Administration) + OPS (Operations); 4 employees
    // (Saudi / non-Saudi mix; EMP-001 Sara is the HR user); leave types +
    // one approved annual leave (Rajesh, 15–17 Nov 2026, 3 working days);
    // full November 2026 attendance (Fri–Sat weekend); one CALCULATED
    // payroll run for Nov 2026 (not yet paid).
    const deptAdm = await tx.department.upsert({
      where: { code_tenantId: { code: 'ADM', tenantId } },
      update: { name: 'Administration', nameAr: 'الإدارة' },
      create: { tenantId, code: 'ADM', name: 'Administration', nameAr: 'الإدارة', status: 'ACTIVE', createdBy: salesUser.id },
    });
    const deptOps = await tx.department.upsert({
      where: { code_tenantId: { code: 'OPS', tenantId } },
      update: { name: 'Operations', nameAr: 'العمليات' },
      create: { tenantId, code: 'OPS', name: 'Operations', nameAr: 'العمليات', status: 'ACTIVE', createdBy: salesUser.id },
    });
    const hrUser = await tx.user.findUniqueOrThrow({ where: { email_tenantId: { email: `hr@${DOMAIN}`, tenantId } } });
    const demoEmployees: {
      code: string; name: string; nameAr: string; nationalId: string; jobTitle: string;
      departmentId: string; hireDate: string; basic: bigint; housing: bigint; transport: bigint;
      bankName: string; iban: string; gosiNumber: string; nationality: string; dependents: number; userId?: string;
    }[] = [
      { code: 'EMP-001', name: 'Sara Al-Harbi', nameAr: 'سارة الحربي', nationalId: '1012345678', jobTitle: 'HR Manager', departmentId: deptAdm.id, hireDate: '2023-01-15', basic: 1200000n, housing: 300000n, transport: 50000n, bankName: 'Al Rajhi Bank', iban: 'SA0380000000608012345678', gosiNumber: '1001234567', nationality: 'SAUDI', dependents: 2, userId: hrUser.id },
      { code: 'EMP-002', name: 'Mohammed Al-Qahtani', nameAr: 'محمد القحطاني', nationalId: '1023456789', jobTitle: 'Warehouse Supervisor', departmentId: deptOps.id, hireDate: '2022-06-01', basic: 800000n, housing: 200000n, transport: 40000n, bankName: 'Al Rajhi Bank', iban: 'SA0380000000608012345679', gosiNumber: '1002345678', nationality: 'SAUDI', dependents: 3 },
      { code: 'EMP-003', name: 'Rajesh Kumar', nameAr: 'راجيش كومار', nationalId: '2345678901', jobTitle: 'Production Worker', departmentId: deptOps.id, hireDate: '2024-03-01', basic: 450000n, housing: 100000n, transport: 30000n, bankName: 'Saudi National Bank', iban: 'SA0310000000608012345680', gosiNumber: '', nationality: 'NON_SAUDI', dependents: 1 },
      { code: 'EMP-004', name: 'Fatima Al-Anzi', nameAr: 'فاطمة العنزي', nationalId: '1034567890', jobTitle: 'Accountant', departmentId: deptAdm.id, hireDate: '2021-09-01', basic: 900000n, housing: 225000n, transport: 50000n, bankName: 'Al Rajhi Bank', iban: 'SA0380000000608012345681', gosiNumber: '1003456789', nationality: 'SAUDI', dependents: 0 },
    ];
    const empIds = new Map<string, string>();
    // Phase 11: national ID / IBAN are encrypted at rest when ENCRYPTION_KEY
    // is set (AES-256-GCM, "enc1:..." values). Without a key the seed stores
    // them as plaintext and the migration script encrypts them later.
    const encryptor = new FieldEncryptor();
    for (const e of demoEmployees) {
      const row = await tx.employee.upsert({
        where: { code_tenantId: { code: e.code, tenantId } },
        update: { name: e.name, nameAr: e.nameAr, jobTitle: e.jobTitle, departmentId: e.departmentId, basicSalaryMinor: e.basic, housingAllowanceMinor: e.housing, transportAllowanceMinor: e.transport },
        create: {
          tenantId, code: e.code, name: e.name, nameAr: e.nameAr, nationalId: encryptor.encrypt(e.nationalId),
          jobTitle: e.jobTitle, departmentId: e.departmentId, branchId: brRiyadh.id,
          hireDate: new Date(`${e.hireDate}T00:00:00.000Z`), status: 'ACTIVE',
          basicSalaryMinor: e.basic, housingAllowanceMinor: e.housing, transportAllowanceMinor: e.transport,
          otherAllowanceMinor: 0n, currency: 'SAR', bankName: e.bankName, iban: encryptor.encrypt(e.iban),
          gosiNumber: e.gosiNumber || null, nationality: e.nationality, dependentsCount: e.dependents,
          userId: e.userId ?? null, createdBy: salesUser.id,
        },
      });
      empIds.set(e.code, row.id);
    }
    await tx.department.update({ where: { id: deptAdm.id }, data: { managerId: empIds.get('EMP-001')! } });
    await tx.department.update({ where: { id: deptOps.id }, data: { managerId: empIds.get('EMP-002')! } });

    const leaveTypes: { code: string; name: string; nameAr: string; days: number; paid: boolean }[] = [
      { code: 'ANNUAL', name: 'Annual Leave', nameAr: 'إجازة سنوية', days: 30, paid: true },
      { code: 'SICK', name: 'Sick Leave', nameAr: 'إجازة مرضية', days: 30, paid: true },
      { code: 'UNPAID', name: 'Unpaid Leave', nameAr: 'إجازة بدون أجر', days: 0, paid: false },
    ];
    const leaveTypeIds = new Map<string, string>();
    for (const lt of leaveTypes) {
      const row = await tx.leaveType.upsert({
        where: { code_tenantId: { code: lt.code, tenantId } },
        update: { name: lt.name, nameAr: lt.nameAr, daysPerYear: lt.days, paid: lt.paid },
        create: { tenantId, code: lt.code, name: lt.name, nameAr: lt.nameAr, daysPerYear: lt.days, paid: lt.paid, status: 'ACTIVE', createdBy: salesUser.id },
      });
      leaveTypeIds.set(lt.code, row.id);
    }
    const existingLeave = await tx.leaveRequest.findFirst({
      where: { tenantId, employeeId: empIds.get('EMP-003')!, leaveTypeId: leaveTypeIds.get('ANNUAL')!, startDate: new Date('2026-11-15T00:00:00.000Z') },
    });
    if (!existingLeave) {
      await tx.leaveRequest.create({
        data: {
          tenantId, employeeId: empIds.get('EMP-003')!, leaveTypeId: leaveTypeIds.get('ANNUAL')!,
          startDate: new Date('2026-11-15T00:00:00.000Z'), endDate: new Date('2026-11-17T00:00:00.000Z'),
          days: 3, status: 'APPROVED', approverId: salesUser.id, notes: 'Approved annual leave.', createdBy: salesUser.id,
        },
      });
    }
    // November 2026 attendance: working days only (Fri–Sat weekend).
    // Rajesh ON_LEAVE 15–17 Nov; Mohammed ABSENT 10–11 Nov; Fatima LATE 9 Nov.
    const absentByEmp = new Map<string, number>();
    for (let day = 1; day <= 30; day += 1) {
      const date = new Date(Date.UTC(2026, 10, day));
      const dow = date.getUTCDay();
      if (dow === 5 || dow === 6) continue; // Friday / Saturday weekend
      for (const e of demoEmployees) {
        const empId = empIds.get(e.code)!;
        let status = 'PRESENT';
        let checkIn: string | null = '08:00';
        if (e.code === 'EMP-003' && day >= 15 && day <= 17) { status = 'ON_LEAVE'; checkIn = null; }
        if (e.code === 'EMP-002' && (day === 10 || day === 11)) { status = 'ABSENT'; checkIn = null; }
        if (e.code === 'EMP-004' && day === 9) { status = 'LATE'; checkIn = '08:45'; }
        if (status === 'ABSENT') absentByEmp.set(e.code, (absentByEmp.get(e.code) ?? 0) + 1);
        await tx.attendanceRecord.upsert({
          where: { employeeId_date_tenantId: { employeeId: empId, date, tenantId } },
          update: { status, checkIn, checkOut: status === 'PRESENT' || status === 'LATE' ? '17:00' : null },
          create: {
            tenantId, employeeId: empId, date, checkIn,
            checkOut: status === 'PRESENT' || status === 'LATE' ? '17:00' : null,
            status, createdBy: salesUser.id,
          },
        });
      }
    }
    const existingRun = await tx.payrollRun.findUnique({ where: { periodYear_periodMonth_tenantId: { periodYear: 2026, periodMonth: 11, tenantId } } });
    if (!existingRun) {
      let gross = 0n;
      let deductions = 0n;
      let net = 0n;
      let gosiEmployer = 0n;
      let eosb = 0n;
      const runLines: Prisma.PayrollLineUncheckedCreateWithoutPayrollRunInput[] = [];
      for (const e of demoEmployees) {
        const line = calculatePayrollLine({
          basicSalaryMinor: e.basic,
          housingAllowanceMinor: e.housing,
          transportAllowanceMinor: e.transport,
          otherAllowanceMinor: 0n,
          nationality: e.nationality,
          hireDate: e.hireDate,
          periodYear: 2026,
          periodMonth: 11,
          absentDays: absentByEmp.get(e.code) ?? 0,
        });
        gross += line.grossMinor;
        deductions += line.gosiEmployeeMinor + line.otherDeductionsMinor;
        net += line.netMinor;
        gosiEmployer += line.gosiEmployerMinor;
        eosb += line.eosbAccrualMinor;
        runLines.push({
          tenantId, employeeId: empIds.get(e.code)!,
          basicSalaryMinor: line.basicSalaryMinor, allowancesMinor: line.allowancesMinor,
          overtimeMinor: line.overtimeMinor, grossMinor: line.grossMinor,
          gosiEmployeeMinor: line.gosiEmployeeMinor, otherDeductionsMinor: line.otherDeductionsMinor,
          netMinor: line.netMinor, gosiEmployerMinor: line.gosiEmployerMinor,
          eosbAccrualMinor: line.eosbAccrualMinor, absentDays: line.absentDays, workingDays: line.workingDays,
          createdBy: salesUser.id,
        });
      }
      await tx.payrollRun.create({
        data: {
          tenantId, periodYear: 2026, periodMonth: 11, status: 'CALCULATED', currency: 'SAR',
          grossMinor: gross, deductionsMinor: deductions, netMinor: net,
          gosiEmployerMinor: gosiEmployer, eosbMinor: eosb,
          notes: 'Demo run — November 2026 salaries (not yet approved/paid).', createdBy: salesUser.id,
          lines: { create: runLines },
        },
      });
    }

    // --- Phase 9 — Projects demo ---
    // Trade-show booth / store fit-out for Al-Noor Retail (MILESTONE billing):
    // PRJ-001 ACTIVE, budget SAR 20,000; 2 tasks; approved timesheets
    // (Sara 12h @ 7,500/hr = 90,000; Mohammed 6h @ 5,000/hr = 30,000);
    // one APPROVED materials expense (SAR 1,500); milestone 1 achieved with
    // a DRAFT invoice INV-2026-00002 (SAR 5,000, not yet posted, so costing
    // revenue is 0 until it posts — see docs/erd-phase9.md).
    const demoProject = await tx.project.upsert({
      where: { code_tenantId: { code: 'PRJ-001', tenantId } },
      update: { name: 'Riyadh Trade Show Booth — Store Fit-Out', status: 'ACTIVE', billingType: 'MILESTONE' },
      create: {
        tenantId, code: 'PRJ-001', name: 'Riyadh Trade Show Booth — Store Fit-Out',
        nameAr: 'تجهيز جناح معرض الرياض التجاري', customerId: alNoor.id, managerId: owner.id,
        status: 'ACTIVE', startDate: new Date('2026-11-01T00:00:00.000Z'), dueDate: new Date('2026-12-15T00:00:00.000Z'),
        budgetMinor: 2_000_000n, currency: 'SAR', billingType: 'MILESTONE',
        description: 'Design and build the Al-Noor Retail booth for the Riyadh trade show.', createdBy: salesUser.id,
      },
    });
    const demoTasks: { title: string; assignee: string; hours: number; rate: bigint | null }[] = [
      { title: 'Booth design and 3D mockup', assignee: empIds.get('EMP-001')!, hours: 0, rate: null },
      { title: 'Booth build and on-site setup', assignee: empIds.get('EMP-002')!, hours: 0, rate: null },
    ];
    const demoTaskIds = new Map<string, string>();
    for (const t of demoTasks) {
      const existing = await tx.projectTask.findFirst({ where: { tenantId, projectId: demoProject.id, title: t.title } });
      const row = existing ?? await tx.projectTask.create({
        data: {
          tenantId, projectId: demoProject.id, title: t.title, assigneeId: t.assignee,
          status: 'IN_PROGRESS', dueDate: new Date('2026-12-10T00:00:00.000Z'),
          estimatedMinutes: 40 * 60, priority: 'HIGH', createdBy: salesUser.id,
        },
      });
      demoTaskIds.set(t.title, row.id);
    }
    const demoTimesheets: { employee: string; task: string; date: string; minutes: number }[] = [
      { employee: empIds.get('EMP-001')!, task: demoTaskIds.get('Booth design and 3D mockup')!, date: '2026-11-10', minutes: 480 },
      { employee: empIds.get('EMP-001')!, task: demoTaskIds.get('Booth design and 3D mockup')!, date: '2026-11-12', minutes: 240 },
      { employee: empIds.get('EMP-002')!, task: demoTaskIds.get('Booth build and on-site setup')!, date: '2026-11-17', minutes: 360 },
    ];
    for (const ts of demoTimesheets) {
      const date = new Date(`${ts.date}T00:00:00.000Z`);
      const existing = await tx.timesheet.findFirst({ where: { tenantId, employeeId: ts.employee, projectId: demoProject.id, taskId: ts.task, date } });
      if (!existing) {
        await tx.timesheet.create({
          data: {
            tenantId, employeeId: ts.employee, projectId: demoProject.id, taskId: ts.task,
            date, minutesInt: ts.minutes, billable: true, description: 'Demo timesheet entry.',
            status: 'APPROVED', approverId: salesUser.id, createdBy: salesUser.id,
          },
        });
      }
    }
    const existingExpense = await tx.projectExpense.findFirst({ where: { tenantId, projectId: demoProject.id, category: 'MATERIALS' } });
    if (!existingExpense) {
      await tx.projectExpense.create({
        data: {
          tenantId, projectId: demoProject.id, date: new Date('2026-11-14T00:00:00.000Z'),
          category: 'MATERIALS', amountMinor: 150_000n, currency: 'SAR',
          description: 'Booth display materials.', status: 'APPROVED',
          submittedBy: salesUser.id, createdBy: salesUser.id,
        },
      });
    }
    let demoMilestone = await tx.milestone.findFirst({ where: { tenantId, projectId: demoProject.id, title: 'Booth design approved' } });
    if (!demoMilestone) {
      demoMilestone = await tx.milestone.create({
        data: {
          tenantId, projectId: demoProject.id, title: 'Booth design approved',
          dueDate: new Date('2026-11-20T00:00:00.000Z'), amountMinor: 500_000n,
          status: 'PENDING', createdBy: salesUser.id,
        },
      });
    }
    if (demoMilestone.status === 'PENDING') {
      let milestoneInvoice = await tx.salesInvoice.findFirst({ where: { tenantId, number: 'INV-2026-00002' } });
      if (!milestoneInvoice) {
        milestoneInvoice = await tx.salesInvoice.create({
          data: {
            tenantId, number: 'INV-2026-00002', type: 'INVOICE', customerId: alNoor.id,
            projectId: demoProject.id, status: 'DRAFT', currency: 'SAR',
            invoiceDate: new Date('2026-11-20T00:00:00.000Z'), dueDate: new Date('2026-12-20T00:00:00.000Z'),
            subtotalMinor: 500_000n, discountMinor: 0n, taxMinor: 0n, totalMinor: 500_000n, paidMinor: 0n,
            notes: 'Milestone billing: Booth design approved', createdBy: salesUser.id,
            lines: {
              create: [{
                tenantId, itemId: null, description: 'Booth design approved', quantity: 1n,
                unitPriceMinor: 500_000n, discountPct: 0, taxRateBps: 0,
                lineSubtotalMinor: 500_000n, lineDiscountMinor: 0n, lineTaxMinor: 0n,
                lineTotalMinor: 500_000n, lineOrder: 0, createdBy: salesUser.id,
              }],
            },
          },
        });
      }
      await tx.milestone.update({ where: { id: demoMilestone.id }, data: { status: 'INVOICED', invoiceId: milestoneInvoice.id } });
    }

    // --- Phase 10 — Analytics demo ---
    // One saved ReportSnapshot (P&L for November 2026, where the demo
    // ledger lives), computed from the real posted journal lines so the
    // snapshots page is not empty.
    const existingSnapshot = await tx.reportSnapshot.findFirst({ where: { tenantId, type: 'PROFIT_LOSS' } });
    if (!existingSnapshot) {
      const plLines = await tx.journalEntryLine.findMany({
        where: {
          tenantId,
          entry: { status: { in: ['POSTED', 'REVERSED'] }, entryDate: { gte: new Date('2026-11-01T00:00:00.000Z'), lt: new Date('2026-12-01T00:00:00.000Z') } },
        },
        select: { debitMinor: true, creditMinor: true, account: { select: { code: true, type: true } } },
      });
      const pl = computeProfitLoss(plLines.map((l) => ({ accountCode: l.account.code, accountType: l.account.type, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
      await tx.reportSnapshot.create({
        data: {
          tenantId, type: 'PROFIT_LOSS', parameters: { from: '2026-11-01', to: '2026-11-30' },
          format: 'CSV',
          content: {
            type: 'PROFIT_LOSS', generatedAt: new Date().toISOString(),
            from: '2026-11-01T00:00:00.000Z', to: '2026-11-30T00:00:00.000Z',
            revenueMinor: Number(pl.revenueMinor), cogsMinor: Number(pl.cogsMinor),
            grossProfitMinor: Number(pl.grossProfitMinor), operatingExpensesMinor: Number(pl.operatingExpensesMinor),
            netIncomeMinor: Number(pl.netIncomeMinor), grossMarginBps: pl.grossMarginBps, netMarginBps: pl.netMarginBps,
          },
          generatedBy: salesUser.id, createdBy: salesUser.id,
        },
      });
    }

    // Keep the new series counters ahead of the seeded demo numbers.
    await tx.numberingSeries.updateMany({ where: { tenantId, code: 'JE' }, data: { nextNumber: 19 } });
    for (const [code, next] of [['INV', 3], ['QUO', 2], ['SO', 2], ['PO', 2], ['PAY', 2], ['SIN', 2], ['SPAY', 2], ['GRN', 2], ['DN', 2], ['ADJ', 2], ['TRF', 1], ['CNT', 1], ['POS', 3], ['WO', 2], ['MI', 2], ['PR', 2], ['SCR', 2]] as const) {
      await tx.numberingSeries.updateMany({ where: { tenantId, code }, data: { nextNumber: next } });
    }

    // Phase 11 — demo integrations (deliberately inert so the pages are not
    // empty but nothing live is created): one DISABLED webhook endpoint
    // pointing at a placeholder URL, and one REVOKED API key whose plaintext
    // was never issued (hash of a fixed demo string, prefix 0000).
    const demoEndpoint = await tx.webhookEndpoint.findFirst({ where: { tenantId, name: 'Demo webhook (disabled)' } });
    if (!demoEndpoint) {
      await tx.webhookEndpoint.create({
        data: {
          tenantId, name: 'Demo webhook (disabled)', url: 'https://example.com/webhooks/eserp-demo',
          secret: 'demo-secret-change-me', eventTypes: ['sales-invoice.posted', 'order.confirmed'] as unknown as Prisma.InputJsonValue,
          status: 'DISABLED', createdBy: salesUser.id,
        },
      });
    }
    const demoKey = await tx.apiKey.findFirst({ where: { tenantId, name: 'Demo API key (revoked)' } });
    if (!demoKey) {
      await tx.apiKey.create({
        data: {
          tenantId, name: 'Demo API key (revoked)',
          keyHash: createHash('sha256').update('demo-revoked-never-issued').digest('hex'),
          keyPrefix: '0000', scopes: ['sales-invoices:read'] as unknown as Prisma.InputJsonValue,
          status: 'REVOKED', createdBy: salesUser.id,
        },
      });
    }

    await tx.onboardingState.upsert({
      where: { tenantId },
      update: { currentStep: 6, stepsCompleted: [0, 1, 2, 3, 4, 5], completedAt: new Date() },
      create: { tenantId, currentStep: 6, stepsCompleted: [0, 1, 2, 3, 4, 5], completedAt: new Date() },
    });

    const existingWelcome = await tx.notification.findFirst({ where: { tenantId, title: 'Welcome to EsERP' } });
    if (!existingWelcome) {
      await tx.notification.create({ data: { tenantId, title: 'Welcome to EsERP', body: 'Your Saudi demo tenant is ready.', type: 'info' } });
    }
  }, { timeout: 60000 });

  console.log(`Seeded demo tenant ${TENANT_SLUG} (${tenantId}). Owner: admin@${DOMAIN} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
