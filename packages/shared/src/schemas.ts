import { z } from 'zod';

export const emailSchema = z.string().email().max(255);
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');
export const slugSchema = z
  .string()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, digits and hyphens');
export const currencyCodeSchema = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z]{3}$/.test(s), 'Currency must be a 3-letter ISO 4217 code');
export const localeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Invalid locale');
export const uuidSchema = z.string().min(1);
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const registerDto = z.object({
  tenantName: z.string().min(2).max(200),
  slug: slugSchema.optional(),
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  defaultCurrency: currencyCodeSchema.default('SAR'),
  defaultLocale: localeSchema.default('ar'),
});

export const loginDto = z.object({
  email: emailSchema,
  password: z.string().min(1),
  tenantSlug: z.string().min(1).optional(),
});

export const mfaVerifyDto = z.object({
  mfaToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

export const createTenantDto = z.object({
  name: z.string().min(2).max(200),
  slug: slugSchema,
  defaultCurrency: currencyCodeSchema.default('SAR'),
  defaultLocale: localeSchema.default('ar'),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
  calendarType: z.enum(['gregorian', 'hijri']).default('gregorian'),
});

export const companyProfileDto = z.object({
  legalName: z.string().min(1).max(255).optional(),
  tradeName: z.string().min(1).max(255).optional(),
  taxNumber: z.string().max(50).optional(),
  commercialRegistration: z.string().max(50).optional(),
  phone: z.string().max(50).optional(),
  email: emailSchema.optional(),
  website: z.string().url().optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).default('SA'),
  logoFileId: z.string().optional(),
});

export const currencyDto = z.object({
  code: currencyCodeSchema,
  name: z.string().min(1).max(100),
  symbol: z.string().min(1).max(10).optional(),
  isDefault: z.boolean().default(false),
  exchangeRateToDefault: z.number().positive().optional(),
});

export const taxRateDto = z.object({
  name: z.string().min(1).max(100),
  nameAr: z.string().max(100).optional(),
  rateBps: z.number().int().min(0).max(10000),
  type: z.enum(['standard', 'zero_rated', 'exempt']).default('standard'),
  isInclusive: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

export const uomDto = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  nameAr: z.string().max(100).optional(),
  baseUnitCode: z.string().min(1).max(20).optional(),
});

export const uomConversionDto = z.object({
  fromUomId: z.string().min(1),
  toUomId: z.string().min(1),
  factorNumerator: z.number().int().positive(),
  factorDenominator: z.number().int().positive().default(1),
});

export const numberingSeriesDto = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  pattern: z.string().min(1).max(200),
  nextNumber: z.number().int().min(1).default(1),
  prefix: z.string().max(50).optional(),
  suffix: z.string().max(50).optional(),
});

export const warehouseDto = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  isDefault: z.boolean().default(false),
});

export const branchDto = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  city: z.string().max(100).optional(),
  isDefault: z.boolean().default(false),
});

export const roleDto = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  permissionIds: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
});

export const inviteUserDto = z.object({
  email: emailSchema,
  roleNames: z.array(z.enum(['OWNER', 'ADMIN', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'WAREHOUSE', 'HR', 'VIEWER'])).min(1),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

export const onboardingStepDto = z.object({
  step: z.number().int().min(0).max(6),
  data: z.record(z.unknown()).default({}),
});

export const onboardingStepData: Record<number, z.ZodTypeAny> = {
  0: companyProfileDto,
  1: z.object({
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    calendarType: z.enum(['gregorian', 'hijri']),
  }),
  2: z.object({ template: z.enum(['saudi', 'empty']).default('saudi') }),
  3: z.object({ taxes: z.array(taxRateDto).optional() }),
  4: warehouseDto,
  5: z.object({ invites: z.array(inviteUserDto).optional() }),
  6: z.object({ csvText: z.string().optional() }),
};

export const presignedUrlDto = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
  purpose: z.string().max(100).optional(),
});

export type RegisterDto = z.infer<typeof registerDto>;
export type LoginDto = z.infer<typeof loginDto>;

// ---------------------------------------------------------------------------
// Phase 1 — Master Data DTOs
// Money/quantity inputs are integer minor units (never floats); the API
// converts them to BigInt before writing to Prisma.
// ---------------------------------------------------------------------------

/** Saudi VAT number: exactly 15 digits when present. */
export const saudiVatNumberSchema = z.string().regex(/^\d{15}$/, 'Saudi VAT number must be exactly 15 digits');

export const contactTypeSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH']);
export const contactStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const contactDto = z.object({
  type: contactTypeSchema.default('CUSTOMER'),
  legalName: z.string().min(1).max(255),
  legalNameAr: z.string().max(255).optional(),
  displayName: z.string().min(1).max(255),
  taxNumber: saudiVatNumberSchema.optional(),
  commercialRegistration: z.string().min(1).max(50).optional(),
  email: emailSchema.optional(),
  phone: z.string().min(1).max(50).optional(),
  street: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).default('SA'),
  creditLimitMinor: z.number().int().nonnegative().default(0),
  creditLimitCurrency: currencyCodeSchema.default('SAR'),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  status: contactStatusSchema.default('ACTIVE'),
  notes: z.string().max(2000).optional(),
});
export const contactUpdateDto = contactDto.partial();

export const itemCategoryDto = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code must start with a letter or digit and contain only letters, digits, hyphens and underscores'),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  parentId: z.string().min(1).nullable().optional(),
});
export const itemCategoryUpdateDto = itemCategoryDto.partial();

export const costingMethodSchema = z.enum(['FIFO', 'WEIGHTED_AVERAGE', 'STANDARD']);
export const itemStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']);

export const itemDto = z.object({
  sku: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  defaultUomId: z.string().min(1),
  taxRateId: z.string().min(1).nullable().optional(),
  barcode: z.string().min(1).max(50).optional(),
  costingMethod: costingMethodSchema.default('FIFO'),
  standardCostMinor: z.number().int().nonnegative().default(0),
  standardCostCurrency: currencyCodeSchema.default('SAR'),
  salesPriceMinor: z.number().int().nonnegative().default(0),
  salesPriceCurrency: currencyCodeSchema.default('SAR'),
  purchasePriceMinor: z.number().int().nonnegative().default(0),
  purchasePriceCurrency: currencyCodeSchema.default('SAR'),
  status: itemStatusSchema.default('ACTIVE'),
  trackStock: z.boolean().default(true),
  reorderPoint: z.number().int().nonnegative().default(0),
  minStock: z.number().int().nonnegative().default(0),
  maxStock: z.number().int().nonnegative().nullable().optional(),
  imageFileId: z.string().min(1).optional(),
});
export const itemUpdateDto = itemDto.partial();

export const priceListDto = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  currency: currencyCodeSchema.default('SAR'),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validTo: z.string().datetime({ offset: true }).optional(),
  isDefault: z.boolean().default(false),
});
export const priceListUpdateDto = priceListDto.partial();

export const priceListItemDto = z.object({
  itemId: z.string().min(1),
  priceMinor: z.number().int().nonnegative(),
  minQuantity: z.number().int().min(1).default(1),
});

export const csvImportDto = z.object({
  csvText: z.string().min(1, 'CSV text is required'),
});

// ---------------------------------------------------------------------------
// Phase 2 — Accounting DTOs
// Money inputs are integer minor units (never floats); the API converts
// them to BigInt before writing to Prisma. Status/type fields are plain
// strings (Phase 0/1 convention); validation lives here in Zod.
// ---------------------------------------------------------------------------

export const fiscalPeriodStatusSchema = z.enum(['OPEN', 'CLOSED', 'LOCKED']);

export const fiscalPeriodDto = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  periodNumber: z.number().int().min(1).max(12),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  status: fiscalPeriodStatusSchema.default('OPEN'),
}).refine((d) => new Date(d.startDate) <= new Date(d.endDate), {
  message: 'startDate must be on or before endDate',
});
export const fiscalPeriodUpdateDto = z.object({
  status: fiscalPeriodStatusSchema,
});

export const costCenterStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const costCenterDto = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code must start with a letter or digit and contain only letters, digits, hyphens and underscores'),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  parentId: z.string().min(1).nullable().optional(),
  status: costCenterStatusSchema.default('ACTIVE'),
});
export const costCenterUpdateDto = costCenterDto.partial();

export const journalStatusSchema = z.enum(['DRAFT', 'POSTED', 'REVERSED']);
export const journalSourceSchema = z.enum(['MANUAL', 'SALES', 'PURCHASING', 'INVENTORY', 'PAYROLL', 'OPENING', 'ADJUSTMENT']);

export const journalEntryLineDto = z.object({
  accountId: z.string().min(1),
  debitMinor: z.number().int().nonnegative().default(0),
  creditMinor: z.number().int().nonnegative().default(0),
  costCenterId: z.string().min(1).nullable().optional(),
  taxRateId: z.string().min(1).nullable().optional(),
  description: z.string().max(500).optional(),
  lineOrder: z.number().int().min(0).default(0),
});

export const journalEntryDto = z.object({
  entryDate: z.string().datetime({ offset: true }),
  description: z.string().min(1).max(500),
  reference: z.string().max(100).optional(),
  sourceModule: journalSourceSchema.default('MANUAL'),
  currency: currencyCodeSchema.default('SAR'),
  lines: z.array(journalEntryLineDto).min(2, 'A journal entry needs at least two lines'),
});
export const journalEntryUpdateDto = z.object({
  entryDate: z.string().datetime({ offset: true }).optional(),
  description: z.string().min(1).max(500).optional(),
  reference: z.string().max(100).nullable().optional(),
  lines: z.array(journalEntryLineDto).min(2, 'A journal entry needs at least two lines').optional(),
});

export const openingBalanceDto = z.object({
  accountId: z.string().min(1),
  fiscalYear: z.number().int().min(2000).max(2100),
  debitMinor: z.number().int().nonnegative().default(0),
  creditMinor: z.number().int().nonnegative().default(0),
  currency: currencyCodeSchema.default('SAR'),
});
export const openingBalanceUpdateDto = openingBalanceDto.partial().omit({ accountId: true, fiscalYear: true });

export const trialBalanceQueryDto = z.object({
  fiscalPeriodId: z.string().min(1),
});
export const generalLedgerQueryDto = z.object({
  accountId: z.string().min(1),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export const vatSummaryQueryDto = z.object({
  fiscalPeriodId: z.string().min(1),
});

export type FiscalPeriodDto = z.infer<typeof fiscalPeriodDto>;
export type FiscalPeriodUpdateDto = z.infer<typeof fiscalPeriodUpdateDto>;
export type CostCenterDto = z.infer<typeof costCenterDto>;
export type CostCenterUpdateDto = z.infer<typeof costCenterUpdateDto>;
export type JournalEntryLineDto = z.infer<typeof journalEntryLineDto>;
export type JournalEntryDto = z.infer<typeof journalEntryDto>;
export type JournalEntryUpdateDto = z.infer<typeof journalEntryUpdateDto>;
export type OpeningBalanceDto = z.infer<typeof openingBalanceDto>;
export type OpeningBalanceUpdateDto = z.infer<typeof openingBalanceUpdateDto>;

export type ContactDto = z.infer<typeof contactDto>;
export type ContactUpdateDto = z.infer<typeof contactUpdateDto>;
export type ItemCategoryDto = z.infer<typeof itemCategoryDto>;
export type ItemCategoryUpdateDto = z.infer<typeof itemCategoryUpdateDto>;
export type ItemDto = z.infer<typeof itemDto>;
export type ItemUpdateDto = z.infer<typeof itemUpdateDto>;
export type PriceListDto = z.infer<typeof priceListDto>;
export type PriceListUpdateDto = z.infer<typeof priceListUpdateDto>;
export type PriceListItemDto = z.infer<typeof priceListItemDto>;
export type CreateTenantDto = z.infer<typeof createTenantDto>;
export type CompanyProfileDto = z.infer<typeof companyProfileDto>;
export type CurrencyDto = z.infer<typeof currencyDto>;
export type TaxRateDto = z.infer<typeof taxRateDto>;
export type UomDto = z.infer<typeof uomDto>;
export type NumberingSeriesDto = z.infer<typeof numberingSeriesDto>;
export type WarehouseDto = z.infer<typeof warehouseDto>;
export type RoleDto = z.infer<typeof roleDto>;
export type InviteUserDto = z.infer<typeof inviteUserDto>;
export type OnboardingStepDto = z.infer<typeof onboardingStepDto>;

// ---------------------------------------------------------------------------
// Phase 3 — Sales / CRM DTOs
// Money/quantity inputs are integer minor units (never floats); the API
// converts them to BigInt before writing to Prisma. Status/type fields are
// plain strings (Phase 0/1/2 convention); validation lives here in Zod.
// Document line math (gross/discount/VAT/total) lives in sales.ts.
// ---------------------------------------------------------------------------

export const leadSourceSchema = z.enum(['WALK_IN', 'REFERRAL', 'WEBSITE', 'SOCIAL', 'OTHER']);
export const leadStatusSchema = z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'LOST']);

export const leadDto = z.object({
  name: z.string().min(1).max(255),
  company: z.string().max(255).optional(),
  email: emailSchema.optional(),
  phone: z.string().min(1).max(50).optional(),
  source: leadSourceSchema.default('WALK_IN'),
  status: leadStatusSchema.default('NEW'),
  notes: z.string().max(2000).optional(),
  expectedValueMinor: z.number().int().nonnegative().default(0),
  expectedValueCurrency: currencyCodeSchema.default('SAR'),
  contactId: z.string().min(1).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
});
export const leadUpdateDto = leadDto.partial();

export const opportunityStageSchema = z.enum(['PROSPECTING', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']);

export const opportunityDto = z.object({
  customerId: z.string().min(1),
  leadId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(255),
  stage: opportunityStageSchema.default('PROSPECTING'),
  probability: z.number().int().min(0).max(100).default(0),
  expectedValueMinor: z.number().int().nonnegative().default(0),
  expectedValueCurrency: currencyCodeSchema.default('SAR'),
  expectedCloseDate: z.string().datetime({ offset: true }).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
});
export const opportunityUpdateDto = opportunityDto.partial().omit({ customerId: true });

export const quoteStatusSchema = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

export const docLineDto = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceMinor: z.number().int().nonnegative(),
  discountPct: z.number().int().min(0).max(100).default(0),
  taxRateBps: z.number().int().min(0).max(10000).default(1500),
});

export const salesQuoteDto = z.object({
  customerId: z.string().min(1),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(docLineDto).min(1, 'A quote needs at least one line'),
}).refine((d) => new Date(d.validFrom) <= new Date(d.validTo), {
  message: 'validFrom must be on or before validTo',
});
export const salesQuoteUpdateDto = z.object({
  validFrom: z.string().datetime({ offset: true }).optional(),
  validTo: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(docLineDto).min(1).optional(),
});

export const salesOrderStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED']);

export const salesOrderDto = z.object({
  customerId: z.string().min(1),
  quoteId: z.string().min(1).nullable().optional(),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(docLineDto).min(1, 'An order needs at least one line'),
});
export const salesOrderUpdateDto = z.object({
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(docLineDto).min(1).optional(),
});

export const salesInvoiceTypeSchema = z.enum(['INVOICE', 'CREDIT_NOTE']);
export const salesInvoiceStatusSchema = z.enum(['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID']);

export const salesInvoiceDto = z.object({
  type: salesInvoiceTypeSchema.default('INVOICE'),
  customerId: z.string().min(1),
  orderId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  invoiceDate: z.string().datetime({ offset: true }),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(docLineDto).min(1, 'An invoice needs at least one line'),
});
export const salesInvoiceUpdateDto = z.object({
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(docLineDto).min(1).optional(),
});

export const paymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE']);

export const paymentAllocationDto = z.object({
  invoiceId: z.string().min(1),
  amountMinor: z.number().int().positive(),
});

export const customerPaymentDto = z.object({
  customerId: z.string().min(1),
  method: paymentMethodSchema.default('BANK_TRANSFER'),
  reference: z.string().max(100).optional(),
  paymentDate: z.string().datetime({ offset: true }),
  currency: currencyCodeSchema.default('SAR'),
  amountMinor: z.number().int().positive(),
  allocations: z.array(paymentAllocationDto).min(1, 'A payment needs at least one allocation'),
}).refine((d) => d.allocations.reduce((s, a) => s + a.amountMinor, 0) === d.amountMinor, {
  message: 'Allocation amounts must sum to amountMinor',
});

// ---------------------------------------------------------------------------
// Phase 4 — Purchasing DTOs
// Same conventions as Phase 3. A purchase order posts nothing to the ledger
// (commitment only); the supplier invoice posts on POSTED.
// ---------------------------------------------------------------------------

export const purchaseOrderStatusSchema = z.enum(['DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED']);

export const purchaseOrderDto = z.object({
  supplierId: z.string().min(1),
  expectedDate: z.string().datetime({ offset: true }).nullable().optional(),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(docLineDto).min(1, 'A purchase order needs at least one line'),
});
export const purchaseOrderUpdateDto = z.object({
  expectedDate: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(docLineDto).min(1).optional(),
});

export const supplierInvoiceStatusSchema = z.enum(['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID']);

export const supplierInvoiceLineDto = docLineDto.extend({
  purchaseOrderLineId: z.string().min(1).nullable().optional(),
});

export const supplierInvoiceDto = z.object({
  supplierId: z.string().min(1),
  purchaseOrderId: z.string().min(1).nullable().optional(),
  invoiceDate: z.string().datetime({ offset: true }),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(supplierInvoiceLineDto).min(1, 'An invoice needs at least one line'),
});
export const supplierInvoiceUpdateDto = z.object({
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(supplierInvoiceLineDto).min(1).optional(),
});

export const supplierPaymentDto = z.object({
  supplierId: z.string().min(1),
  method: paymentMethodSchema.default('BANK_TRANSFER'),
  reference: z.string().max(100).optional(),
  paymentDate: z.string().datetime({ offset: true }),
  currency: currencyCodeSchema.default('SAR'),
  amountMinor: z.number().int().positive(),
  allocations: z.array(paymentAllocationDto).min(1, 'A payment needs at least one allocation'),
}).refine((d) => d.allocations.reduce((s, a) => s + a.amountMinor, 0) === d.amountMinor, {
  message: 'Allocation amounts must sum to amountMinor',
});

export type LeadDto = z.infer<typeof leadDto>;

// ---------------------------------------------------------------------------
// Phase 5 — Inventory DTOs
// Quantities are integer units (BigInt in the DB); money is integer minor
// units. Stock movements are append-only; corrections are new movements.
// ---------------------------------------------------------------------------

export const stockMovementTypeSchema = z.enum(['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'RETURN_IN', 'RETURN_OUT']);
export const stockMovementSourceSchema = z.enum(['GOODS_RECEIPT', 'DELIVERY_NOTE', 'POS_SALE', 'ADJUSTMENT', 'COUNT', 'TRANSFER']);

export const goodsReceiptLineDto = z.object({
  purchaseOrderLineId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCostMinor: z.number().int().nonnegative(),
});

export const goodsReceiptDto = z.object({
  purchaseOrderId: z.string().min(1),
  warehouseId: z.string().min(1),
  receiptDate: z.string().datetime({ offset: true }),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(goodsReceiptLineDto).min(1, 'A goods receipt needs at least one line'),
});

export const deliveryNoteLineDto = z.object({
  salesOrderLineId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const deliveryNoteDto = z.object({
  salesOrderId: z.string().min(1),
  warehouseId: z.string().min(1),
  deliveryDate: z.string().datetime({ offset: true }),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(deliveryNoteLineDto).min(1, 'A delivery note needs at least one line'),
});

export const adjustmentReasonSchema = z.enum(['DAMAGE', 'THEFT', 'FOUND', 'CORRECTION', 'OTHER']);

export const stockAdjustmentLineDto = z.object({
  itemId: z.string().min(1),
  quantityDelta: z.number().int().refine((n) => n !== 0, 'Quantity delta must not be zero'),
  unitCostMinor: z.number().int().nonnegative().optional(),
  reason: adjustmentReasonSchema.default('CORRECTION'),
});

export const stockAdjustmentDto = z.object({
  warehouseId: z.string().min(1),
  adjustmentDate: z.string().datetime({ offset: true }),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(stockAdjustmentLineDto).min(1, 'An adjustment needs at least one line'),
});

export const stockTransferLineDto = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const stockTransferDto = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  transferDate: z.string().datetime({ offset: true }),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(stockTransferLineDto).min(1, 'A transfer needs at least one line'),
}).refine((d) => d.fromWarehouseId !== d.toWarehouseId, {
  message: 'Source and destination warehouses must differ',
});

export const stockCountLineDto = z.object({
  itemId: z.string().min(1),
  countedQuantity: z.number().int().nonnegative(),
});

export const stockCountDto = z.object({
  warehouseId: z.string().min(1),
  countDate: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
  lines: z.array(stockCountLineDto).min(1, 'A stock count needs at least one line'),
});

// ---------------------------------------------------------------------------
// Phase 6 — POS DTOs
// One combined journal entry per sale (Dr Cash/Card + Dr COGS / Cr Sales
// Revenue + Cr Output VAT + Cr Inventory). POS is online-first: no offline
// queue/sync and no printer/drawer drivers in this phase.
// ---------------------------------------------------------------------------

export const posTerminalStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const posTerminalDto = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code must start with a letter or digit and contain only letters, digits, hyphens and underscores'),
  name: z.string().min(1).max(200),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  status: posTerminalStatusSchema.default('ACTIVE'),
  cashAccountCode: z.string().min(1).max(10).default('1010'),
  cardAccountCode: z.string().min(1).max(10).default('1030'),
});
export const posTerminalUpdateDto = posTerminalDto.partial().omit({ code: true });

export const posShiftDto = z.object({
  terminalId: z.string().min(1),
  openingFloatMinor: z.number().int().nonnegative(),
});

export const posShiftCloseDto = z.object({
  countedCashMinor: z.number().int().nonnegative(),
});

export const posSaleLineDto = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceMinor: z.number().int().nonnegative().optional(),
  discountPct: z.number().int().min(0).max(100).default(0),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
});

export const posPaymentSplitDto = z.object({
  method: z.enum(['CASH', 'CARD']),
  amountMinor: z.number().int().positive(),
  reference: z.string().max(100).optional(),
});

export const posSaleDto = z.object({
  terminalId: z.string().min(1),
  shiftId: z.string().min(1),
  customerId: z.string().min(1).nullable().optional(),
  saleDate: z.string().datetime({ offset: true }).optional(),
  currency: currencyCodeSchema.default('SAR'),
  lines: z.array(posSaleLineDto).min(1, 'A sale needs at least one line'),
  payments: z.array(posPaymentSplitDto).min(1, 'A sale needs at least one payment'),
});

export type GoodsReceiptDto = z.infer<typeof goodsReceiptDto>;
export type DeliveryNoteDto = z.infer<typeof deliveryNoteDto>;
export type StockAdjustmentDto = z.infer<typeof stockAdjustmentDto>;
export type StockTransferDto = z.infer<typeof stockTransferDto>;
export type StockCountDto = z.infer<typeof stockCountDto>;
export type PosTerminalDto = z.infer<typeof posTerminalDto>;
export type PosTerminalUpdateDto = z.infer<typeof posTerminalUpdateDto>;
export type PosShiftDto = z.infer<typeof posShiftDto>;
export type PosShiftCloseDto = z.infer<typeof posShiftCloseDto>;
export type PosSaleDto = z.infer<typeof posSaleDto>;

// ---------------------------------------------------------------------------
// Phase 7 — Manufacturing DTOs
// Quantities are integer units; money is integer minor units (never floats).
// Scrap % is integer basis points (500 = 5%).
// ---------------------------------------------------------------------------

export const workCenterStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const workCenterDto = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code must start with a letter or digit and contain only letters, digits, hyphens and underscores'),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  standardCostRateMinor: z.number().int().nonnegative().default(0),
  status: workCenterStatusSchema.default('ACTIVE'),
});
export const workCenterUpdateDto = workCenterDto.partial().omit({ code: true });

export const bomStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);

export const bomLineDto = z.object({
  componentItemId: z.string().min(1),
  quantityPerUnit: z.number().int().positive(),
  scrapBps: z.number().int().min(0).max(10000).default(0),
  workCenterId: z.string().min(1).nullable().optional(),
  operationName: z.string().max(200).optional(),
});

export const bomDto = z.object({
  finishedItemId: z.string().min(1),
  version: z.number().int().positive().default(1),
  status: bomStatusSchema.default('DRAFT'),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(bomLineDto).min(1, 'A BOM needs at least one line'),
});
export const bomUpdateDto = z.object({
  status: bomStatusSchema.optional(),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(bomLineDto).min(1).optional(),
});

export const workOrderStatusSchema = z.enum(['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

export const workOrderOperationDto = z.object({
  name: z.string().min(1).max(200),
  workCenterId: z.string().min(1).nullable().optional(),
  plannedHours: z.number().int().nonnegative().default(0),
});

export const workOrderDto = z.object({
  finishedItemId: z.string().min(1),
  bomId: z.string().min(1),
  warehouseId: z.string().min(1),
  qtyPlanned: z.number().int().positive(),
  plannedStartDate: z.string().datetime({ offset: true }).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  operations: z.array(workOrderOperationDto).default([]),
});
export const workOrderUpdateDto = z.object({
  plannedStartDate: z.string().datetime({ offset: true }).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(2000).optional(),
});

export const workOrderOperationUpdateDto = z.object({
  actualHours: z.number().int().nonnegative(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

export const materialIssueLineDto = z.object({
  workOrderLineId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const materialIssueDto = z.object({
  workOrderId: z.string().min(1),
  warehouseId: z.string().min(1),
  issueDate: z.string().datetime({ offset: true }).optional(),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
  lines: z.array(materialIssueLineDto).min(1, 'An issue needs at least one line'),
});

export const productionReceiptDto = z.object({
  workOrderId: z.string().min(1),
  warehouseId: z.string().min(1),
  receiptDate: z.string().datetime({ offset: true }).optional(),
  quantity: z.number().int().positive(),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
});

export const scrapKindSchema = z.enum(['COMPONENT', 'FINISHED']);

export const scrapDto = z.object({
  workOrderId: z.string().min(1).nullable().optional(),
  kind: scrapKindSchema,
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  scrapDate: z.string().datetime({ offset: true }).optional(),
  currency: currencyCodeSchema.default('SAR'),
});

export type WorkCenterDto = z.infer<typeof workCenterDto>;
export type WorkCenterUpdateDto = z.infer<typeof workCenterUpdateDto>;
export type BomDto = z.infer<typeof bomDto>;
export type BomUpdateDto = z.infer<typeof bomUpdateDto>;
export type BomLineDto = z.infer<typeof bomLineDto>;
export type WorkOrderDto = z.infer<typeof workOrderDto>;
export type WorkOrderUpdateDto = z.infer<typeof workOrderUpdateDto>;
export type WorkOrderOperationDto = z.infer<typeof workOrderOperationDto>;
export type MaterialIssueDto = z.infer<typeof materialIssueDto>;
export type ProductionReceiptDto = z.infer<typeof productionReceiptDto>;
export type ScrapDto = z.infer<typeof scrapDto>;

// ---------------------------------------------------------------------------
// Phase 8 — HR / Payroll DTOs
// Money is integer minor units (never floats). National ID / Iqama is stored
// as a plain string in Phase 8 (field encryption is a Phase 11 hardening item).
// ---------------------------------------------------------------------------

export const departmentStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const departmentDto = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code must start with a letter or digit and contain only letters, digits, hyphens and underscores'),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  parentId: z.string().min(1).nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
  status: departmentStatusSchema.default('ACTIVE'),
});
export const departmentUpdateDto = departmentDto.partial().omit({ code: true });

export const employeeStatusSchema = z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']);
export const nationalitySchema = z.enum(['SAUDI', 'NON_SAUDI']);

export const employeeDto = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code must start with a letter or digit and contain only letters, digits, hyphens and underscores'),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  nationalId: z.string().min(1).max(50).optional(),
  jobTitle: z.string().min(1).max(200),
  departmentId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  hireDate: z.string().datetime({ offset: true }),
  status: employeeStatusSchema.default('ACTIVE'),
  basicSalaryMinor: z.number().int().nonnegative(),
  housingAllowanceMinor: z.number().int().nonnegative().default(0),
  transportAllowanceMinor: z.number().int().nonnegative().default(0),
  otherAllowanceMinor: z.number().int().nonnegative().default(0),
  currency: currencyCodeSchema.default('SAR'),
  bankName: z.string().max(200).optional(),
  iban: z.string().max(50).optional(),
  gosiNumber: z.string().max(50).optional(),
  nationality: nationalitySchema.default('SAUDI'),
  dependentsCount: z.number().int().nonnegative().default(0),
  userId: z.string().min(1).nullable().optional(),
});
export const employeeUpdateDto = employeeDto.partial().omit({ code: true });
export const employeeTerminateDto = z.object({
  endDate: z.string().datetime({ offset: true }),
});

export const leaveTypeDto = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Code must start with a letter or digit and contain only letters, digits, hyphens and underscores'),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  daysPerYear: z.number().int().min(0).max(365),
  paid: z.boolean().default(true),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
export const leaveTypeUpdateDto = leaveTypeDto.partial().omit({ code: true });

export const leaveRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);

export const leaveRequestDto = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
}).refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
  message: 'Leave end date must not be before start date',
});

export const leaveRequestDecisionDto = z.object({
  approverId: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
});

export const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE', 'HOLIDAY']);

export const attendanceRecordDto = z.object({
  employeeId: z.string().min(1),
  date: z.string().datetime({ offset: true }),
  checkIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'checkIn must be HH:mm').nullable().optional(),
  checkOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'checkOut must be HH:mm').nullable().optional(),
  status: attendanceStatusSchema.default('PRESENT'),
  notes: z.string().max(1000).optional(),
});

export const attendanceBulkDto = z.object({
  date: z.string().datetime({ offset: true }),
  records: z.array(attendanceRecordDto.omit({ date: true })).min(1, 'Bulk entry needs at least one record'),
});

export const payrollRunDto = z.object({
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  currency: currencyCodeSchema.default('SAR'),
  notes: z.string().max(2000).optional(),
});

export const payrollLineOverrideDto = z.object({
  employeeId: z.string().min(1),
  overtimeMinor: z.number().int().nonnegative().default(0),
  otherDeductionsMinor: z.number().int().nonnegative().default(0),
});

export const payrollCalculateDto = z.object({
  overrides: z.array(payrollLineOverrideDto).default([]),
});

export const payrollPayDto = z.object({
  bankAccountCode: z.string().min(1).max(10).default('1020'),
  paymentDate: z.string().datetime({ offset: true }),
});

// --- Phase 9 — Projects ------------------------------------------------------

export const projectStatusSchema = z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
export const projectBillingTypeSchema = z.enum(['FIXED_PRICE', 'TIME_AND_MATERIALS', 'MILESTONE']);
export const projectTaskStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']);
export const projectTaskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const timesheetStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']);
export const projectExpenseCategorySchema = z.enum(['TRAVEL', 'MATERIALS', 'SERVICES', 'OTHER']);
export const projectExpenseStatusSchema = z.enum(['DRAFT', 'APPROVED', 'REJECTED']);
export const milestoneStatusSchema = z.enum(['PENDING', 'ACHIEVED', 'INVOICED']);

export const projectDto = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  customerId: z.string().min(1).nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
  status: projectStatusSchema.default('PLANNING'),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  budgetMinor: z.number().int().nonnegative().default(0),
  currency: currencyCodeSchema.default('SAR'),
  billingType: projectBillingTypeSchema.default('FIXED_PRICE'),
  description: z.string().max(4000).optional(),
});
export const projectUpdateDto = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().max(200).nullable().optional(),
  customerId: z.string().min(1).nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
  status: projectStatusSchema.optional(),
  startDate: z.string().datetime({ offset: true }).nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  budgetMinor: z.number().int().nonnegative().optional(),
  currency: currencyCodeSchema.optional(),
  billingType: projectBillingTypeSchema.optional(),
  description: z.string().max(4000).nullable().optional(),
});

export const projectTaskDto = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(300),
  assigneeId: z.string().min(1).nullable().optional(), // Employee id
  status: projectTaskStatusSchema.default('TODO'),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedHours: z.number().positive().max(10000).nullable().optional(),
  hourlyRateMinor: z.number().int().nonnegative().nullable().optional(),
  priority: projectTaskPrioritySchema.default('MEDIUM'),
});
export const projectTaskUpdateDto = z.object({
  title: z.string().min(1).max(300).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  status: projectTaskStatusSchema.optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedHours: z.number().positive().max(10000).nullable().optional(),
  hourlyRateMinor: z.number().int().nonnegative().nullable().optional(),
  priority: projectTaskPrioritySchema.optional(),
});

export const timesheetDto = z.object({
  employeeId: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1).nullable().optional(),
  date: z.string().datetime({ offset: true }),
  /** Decimal hours, e.g. 7.5 — stored as integer minutes. */
  hours: z.number().positive().max(24),
  billable: z.boolean().default(true),
  description: z.string().max(2000).optional(),
});
export const timesheetUpdateDto = z.object({
  taskId: z.string().min(1).nullable().optional(),
  date: z.string().datetime({ offset: true }).optional(),
  hours: z.number().positive().max(24).optional(),
  billable: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const projectExpenseDto = z.object({
  projectId: z.string().min(1),
  date: z.string().datetime({ offset: true }),
  category: projectExpenseCategorySchema.default('OTHER'),
  amountMinor: z.number().int().positive(),
  currency: currencyCodeSchema.default('SAR'),
  description: z.string().max(2000).optional(),
  receiptFileId: z.string().min(1).nullable().optional(), // FileAsset id (plain string)
});
export const projectExpenseUpdateDto = z.object({
  date: z.string().datetime({ offset: true }).optional(),
  category: projectExpenseCategorySchema.optional(),
  amountMinor: z.number().int().positive().optional(),
  currency: currencyCodeSchema.optional(),
  description: z.string().max(2000).nullable().optional(),
  receiptFileId: z.string().min(1).nullable().optional(),
});

export const milestoneDto = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(300),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  amountMinor: z.number().int().nonnegative().default(0),
  status: milestoneStatusSchema.default('PENDING'),
});
export const milestoneUpdateDto = z.object({
  title: z.string().min(1).max(300).optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  amountMinor: z.number().int().nonnegative().optional(),
});

// --- Phase 10 — Analytics / AI ----------------------------------------------

export const reportSnapshotDto = z.object({
  type: z.string().min(1).max(50), // PROFIT_LOSS | BALANCE_SHEET | CASH_FLOW | AR_AGING | AP_AGING | STOCK_VALUATION | SALES_BY_ITEM | SALES_BY_CUSTOMER
  parameters: z.record(z.string(), z.unknown()).default({}),
  format: z.enum(['CSV', 'JSON']).default('CSV'),
  /** Inline JSON payload (stored when format is JSON or as the snapshot body). */
  content: z.record(z.string(), z.unknown()).optional(),
  fileAssetId: z.string().min(1).nullable().optional(),
});

export const aiAskDto = z.object({
  question: z.string().min(1).max(1000),
});

// --- Phase 11 — Integrations -------------------------------------------------

export const zatcaDocumentTypeSchema = z.enum(['SIMPLIFIED', 'STANDARD']);

export const zatcaGenerateDto = z.object({
  invoiceId: z.string().min(1),
  type: zatcaDocumentTypeSchema.default('SIMPLIFIED'),
});

export const webhookEndpointDto = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().max(2000),
  secret: z.string().min(16).max(255).optional(),
  eventTypes: z.array(z.string().min(1)).min(1).max(50),
  status: z.enum(['ACTIVE', 'DISABLED']).default('DISABLED'),
});

export const webhookEndpointUpdateDto = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url().max(2000).optional(),
  secret: z.string().min(16).max(255).optional(),
  eventTypes: z.array(z.string().min(1)).min(1).max(50).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const apiKeyDto = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1)).min(1).max(50),
  expiresAt: z.string().datetime().optional(),
});

export const exportJobDto = z.object({
  type: z.enum(['contacts', 'items', 'sales-invoices', 'purchase-orders', 'journal-entries', 'stock-levels', 'employees']),
  format: z.enum(['CSV', 'JSON']).default('CSV'),
});

export const mockPaymentChargeDto = z.object({
  amountMinor: z.number().int().positive(),
  currency: currencyCodeSchema.default('SAR'),
  description: z.string().max(255).optional(),
  reference: z.string().max(100).optional(),
});

export const mockSmsDto = z.object({
  to: z.string().min(1).max(50),
  message: z.string().min(1).max(1000),
});

export type DepartmentDto = z.infer<typeof departmentDto>;
export type DepartmentUpdateDto = z.infer<typeof departmentUpdateDto>;
export type EmployeeDto = z.infer<typeof employeeDto>;
export type EmployeeUpdateDto = z.infer<typeof employeeUpdateDto>;
export type LeaveTypeDto = z.infer<typeof leaveTypeDto>;
export type LeaveTypeUpdateDto = z.infer<typeof leaveTypeUpdateDto>;
export type LeaveRequestDto = z.infer<typeof leaveRequestDto>;
export type AttendanceRecordDto = z.infer<typeof attendanceRecordDto>;
export type AttendanceBulkDto = z.infer<typeof attendanceBulkDto>;
export type PayrollRunDto = z.infer<typeof payrollRunDto>;
export type PayrollCalculateDto = z.infer<typeof payrollCalculateDto>;
export type PayrollPayDto = z.infer<typeof payrollPayDto>;
export type ProjectDto = z.infer<typeof projectDto>;
export type ProjectUpdateDto = z.infer<typeof projectUpdateDto>;
export type ProjectTaskDto = z.infer<typeof projectTaskDto>;
export type ProjectTaskUpdateDto = z.infer<typeof projectTaskUpdateDto>;
export type TimesheetDto = z.infer<typeof timesheetDto>;
export type TimesheetUpdateDto = z.infer<typeof timesheetUpdateDto>;
export type ProjectExpenseDto = z.infer<typeof projectExpenseDto>;
export type ProjectExpenseUpdateDto = z.infer<typeof projectExpenseUpdateDto>;
export type MilestoneDto = z.infer<typeof milestoneDto>;
export type MilestoneUpdateDto = z.infer<typeof milestoneUpdateDto>;
export type ReportSnapshotDto = z.infer<typeof reportSnapshotDto>;
export type AiAskDto = z.infer<typeof aiAskDto>;
export type ZatcaGenerateDto = z.infer<typeof zatcaGenerateDto>;
export type WebhookEndpointDto = z.infer<typeof webhookEndpointDto>;
export type WebhookEndpointUpdateDto = z.infer<typeof webhookEndpointUpdateDto>;
export type ApiKeyDto = z.infer<typeof apiKeyDto>;
export type ExportJobDto = z.infer<typeof exportJobDto>;
export type MockPaymentChargeDto = z.infer<typeof mockPaymentChargeDto>;
export type MockSmsDto = z.infer<typeof mockSmsDto>;
export type LeadUpdateDto = z.infer<typeof leadUpdateDto>;
export type OpportunityDto = z.infer<typeof opportunityDto>;
export type OpportunityUpdateDto = z.infer<typeof opportunityUpdateDto>;
export type DocLineDto = z.infer<typeof docLineDto>;
export type SalesQuoteDto = z.infer<typeof salesQuoteDto>;
export type SalesQuoteUpdateDto = z.infer<typeof salesQuoteUpdateDto>;
export type SalesOrderDto = z.infer<typeof salesOrderDto>;
export type SalesOrderUpdateDto = z.infer<typeof salesOrderUpdateDto>;
export type SalesInvoiceDto = z.infer<typeof salesInvoiceDto>;
export type SalesInvoiceUpdateDto = z.infer<typeof salesInvoiceUpdateDto>;
export type CustomerPaymentDto = z.infer<typeof customerPaymentDto>;
export type PurchaseOrderDto = z.infer<typeof purchaseOrderDto>;
export type PurchaseOrderUpdateDto = z.infer<typeof purchaseOrderUpdateDto>;
export type SupplierInvoiceDto = z.infer<typeof supplierInvoiceDto>;
export type SupplierInvoiceUpdateDto = z.infer<typeof supplierInvoiceUpdateDto>;
export type SupplierPaymentDto = z.infer<typeof supplierPaymentDto>;
