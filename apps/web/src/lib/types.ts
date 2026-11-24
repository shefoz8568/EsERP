/**
 * API response shapes.
 *
 * The UI works with the normalised shapes below. The real API (see
 * apps/api + @eserp/shared DTOs) differs from the original brief in a few
 * places — nested `tokens`, body-based refresh, `rateBps`, `roleNames`,
 * `pageSize`, `readAt`, company-profile fields — and src/lib/api.ts
 * normalises those responses into these shapes on the way in.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  locale: string;
  roles: string[];
  /**
   * Expanded permission names from GET /auth/me (e.g. "warehouses:read").
   * Undefined when the server response did not carry them (login/register
   * responses) — callers must fail open in that case, the API still
   * enforces authorisation. AuthProvider fills this in from /auth/me.
   */
  permissions?: string[];
}

/** Raw user object as returned by the API (flat, no `name` field). */
export interface RawAuthUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  tenantId: string;
  tenant?: { id: string; name: string; slug: string };
  locale?: string;
  roles?: string[];
  permissions?: string[];
  mfaEnabled?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  slug?: string;
  defaultCurrency?: string;
  defaultLocale?: string;
  fiscalYearStartMonth?: number;
  calendarType?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user: AuthUser;
  mfaRequired?: boolean;
  mfaToken?: string;
}

export interface RegisterResponse {
  accessToken: string;
  refreshToken?: string;
  user: AuthUser;
  tenant: Tenant;
}

/** Company profile row (Prisma CompanyProfile) as returned by the API. */
export interface CompanySettings {
  id?: string;
  legalName?: string | null;
  tradeName?: string | null;
  taxNumber?: string | null;
  commercialRegistration?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string;
}

/** Display name for a company profile: trade name, else legal name. */
export function companyDisplayName(c: CompanySettings | null | undefined): string {
  return c?.tradeName ?? c?.legalName ?? "";
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol?: string | null;
  isDefault: boolean;
  exchangeRateToDefault?: number | null;
}

export interface Tax {
  id: string;
  name: string;
  /** Rate in basis points: 1500 = 15%. UI converts to/from percent. */
  rateBps: number;
  type: string;
  isInclusive: boolean;
  isDefault: boolean;
}

/** Percent (e.g. 15) <-> basis points (1500) helpers for the Tax UI. */
export const percentToBps = (percent: number): number => Math.round(percent * 100);
export const bpsToPercent = (bps: number): number => bps / 100;

export interface Unit {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  baseUnitCode?: string | null;
}

export interface NumberingSeries {
  id: string;
  code: string;
  name: string;
  pattern: string;
  nextNumber: number;
  prefix?: string | null;
  suffix?: string | null;
}

export interface Warehouse {
  id: string;
  name: string;
  code?: string | null;
  address?: string | null;
  city?: string | null;
  isDefault?: boolean;
}

export interface Branch {
  id: string;
  name: string;
  code?: string | null;
  city?: string | null;
  isDefault?: boolean;
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  /** First role name, for display. */
  role: string;
  roles: string[];
  status?: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
}

export interface AuditLog {
  id: string;
  createdAt: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
}

export interface NotificationItem {
  id: string;
  title: string;
  body?: string | null;
  type?: string;
  createdAt: string;
  /** Derived from readAt != null (the API stores readAt, not a boolean). */
  read: boolean;
  readAt?: string | null;
}

/** Onboarding state row (Prisma OnboardingState) + totalSteps. */
export interface OnboardingState {
  id?: string;
  tenantId?: string;
  currentStep: number;
  stepsCompleted: number[];
  completedAt?: string | null;
  totalSteps: number;
}

export function isOnboardingComplete(s: OnboardingState | null | undefined): boolean {
  return !!s?.completedAt;
}

export interface CsvPreviewResult {
  rows: number;
  valid: number;
  errors: Array<{ row: number; message: string }>;
  preview: Array<Record<string, string>>;
}

/* ------------------------------------------------------- Phase 1: master data */

export interface Contact {
  id: string;
  type: 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
  legalName: string;
  legalNameAr?: string | null;
  displayName: string;
  taxNumber?: string | null;
  commercialRegistration?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string;
  creditLimitMinor: number;
  creditLimitCurrency: string;
  paymentTermsDays: number;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string | null;
}

export interface ItemCategory {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  description?: string | null;
  parentId?: string | null;
  _count?: { items: number; children: number };
}

export interface Item {
  id: string;
  sku: string;
  name: string;
  nameAr?: string | null;
  description?: string | null;
  categoryId?: string | null;
  category?: ItemCategory | null;
  defaultUomId: string;
  defaultUom?: { id: string; code: string; name: string } | null;
  taxRateId?: string | null;
  taxRate?: { id: string; name: string; rateBps: number } | null;
  barcode?: string | null;
  costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE' | 'STANDARD';
  standardCostMinor: number;
  standardCostCurrency: string;
  salesPriceMinor: number;
  salesPriceCurrency: string;
  purchasePriceMinor: number;
  purchasePriceCurrency: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  trackStock: boolean;
  reorderPoint: number;
  minStock: number;
  maxStock?: number | null;
  imageFileId?: string | null;
}

export interface PriceListItem {
  id: string;
  priceListId: string;
  itemId: string;
  priceMinor: number;
  minQuantity: number;
  item?: { id: string; sku: string; name: string; nameAr?: string | null } | null;
}

export interface PriceList {
  id: string;
  name: string;
  nameAr?: string | null;
  currency: string;
  validFrom?: string | null;
  validTo?: string | null;
  isDefault: boolean;
  items?: PriceListItem[];
  _count?: { items: number };
}

export interface Paginated<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// --- Phase 2 — Accounting ---

export interface JournalEntryLine {
  id: string;
  accountId: string;
  account?: { id: string; code: string; nameEn: string; nameAr: string; type: string } | null;
  debitMinor: number;
  creditMinor: number;
  currency: string;
  costCenterId?: string | null;
  costCenter?: { id: string; code: string; name: string } | null;
  taxRateId?: string | null;
  taxRate?: { id: string; name: string; rateBps: number } | null;
  description?: string | null;
  lineOrder: number;
}

export interface JournalEntry {
  id: string;
  number: string;
  entryDate: string;
  fiscalPeriodId: string;
  fiscalPeriod?: { id: string; fiscalYear: number; periodNumber: number; status: string } | null;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  description: string;
  reference?: string | null;
  sourceModule: string;
  currency: string;
  totalDebitMinor: number;
  totalCreditMinor: number;
  postedAt?: string | null;
  postedBy?: string | null;
  reverses?: { id: string; number: string } | null;
  reversedBy?: { id: string; number: string } | null;
  lines: JournalEntryLine[];
}

export interface FiscalPeriod {
  id: string;
  fiscalYear: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  _count?: { journalEntries: number };
}

export interface ChartAccount {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
  parentId?: string | null;
  isPosting: boolean;
}

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  parentId?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  _count?: { children: number; journalLines: number };
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingDebitMinor: number;
  openingCreditMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  closingNetMinor: number;
  closingDebitMinor: number;
  closingCreditMinor: number;
}

export interface TrialBalance {
  fiscalPeriod: { id: string; fiscalYear: number; periodNumber: number; status: string };
  rows: TrialBalanceRow[];
  totals: {
    openingDebitMinor: number;
    openingCreditMinor: number;
    periodDebitMinor: number;
    periodCreditMinor: number;
    closingDebitMinor: number;
    closingCreditMinor: number;
  };
}

export interface LedgerLine {
  entryDate: string;
  entryNumber: string;
  description?: string | null;
  debitMinor: number;
  creditMinor: number;
  runningBalanceMinor: number;
}

export interface GeneralLedger {
  account: { id: string; code: string; nameEn: string; nameAr: string; type: string };
  from: string;
  to: string;
  openingNetMinor: number;
  lines: LedgerLine[];
  closingNetMinor: number;
}

export interface VatSummary {
  fiscalPeriod: { id: string; fiscalYear: number; periodNumber: number; status: string };
  currency: string;
  outputVatMinor: number;
  inputVatMinor: number;
  netVatPayableMinor: number;
  lines: {
    entryNumber: string;
    entryDate: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    debitMinor: number;
    creditMinor: number;
    taxRateName: string;
    rateBps: number;
  }[];
}

/* -------------------------------------------- Phase 3: sales / CRM */

export interface Lead {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  source: string;
  status: string;
  notes?: string | null;
  expectedValueMinor: number;
  expectedValueCurrency: string;
  contactId?: string | null;
  contact?: { id: string; displayName: string } | null;
}

export interface Opportunity {
  id: string;
  customerId: string;
  customer?: { id: string; displayName: string; legalName: string } | null;
  leadId?: string | null;
  lead?: { id: string; name: string } | null;
  title: string;
  stage: string;
  probability: number;
  expectedValueMinor: number;
  expectedValueCurrency: string;
  expectedCloseDate?: string | null;
  ownerId?: string | null;
}

export interface DocLine {
  id?: string;
  itemId: string;
  item?: { id: string; sku: string; name: string } | null;
  quantity: number;
  unitPriceMinor: number;
  discountPct: number;
  taxRateBps: number;
  lineSubtotalMinor: number;
  lineDiscountMinor: number;
  lineTaxMinor: number;
  lineTotalMinor: number;
  lineOrder: number;
}

export interface SalesQuote {
  id: string;
  number: string;
  customerId: string;
  customer?: { id: string; displayName: string; legalName: string } | null;
  validFrom: string;
  validTo: string;
  status: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  salesOrderId?: string | null;
  notes?: string | null;
  lines: DocLine[];
}

export interface SalesOrder {
  id: string;
  number: string;
  customerId: string;
  customer?: { id: string; displayName: string; legalName: string; creditLimitMinor?: number } | null;
  quoteId?: string | null;
  quote?: { id: string; number: string } | null;
  status: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  notes?: string | null;
  lines: (DocLine & { quantityOrdered: number; quantityFulfilled: number })[];
}

export interface SalesInvoice {
  id: string;
  number: string;
  type: string;
  customerId: string;
  customer?: { id: string; displayName: string; legalName: string } | null;
  orderId?: string | null;
  order?: { id: string; number: string } | null;
  status: string;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  journalEntryId?: string | null;
  notes?: string | null;
  lines: DocLine[];
  allocations?: { id: string; paymentId: string; amountMinor: number }[];
}

export interface CustomerPayment {
  id: string;
  number: string;
  customerId: string;
  customer?: { id: string; displayName: string; legalName: string } | null;
  method: string;
  reference?: string | null;
  paymentDate: string;
  currency: string;
  amountMinor: number;
  journalEntryId?: string | null;
  allocations: { id: string; invoiceId: string; amountMinor: number; invoice?: { id: string; number: string; totalMinor: number; paidMinor: number; status: string } }[];
}

export interface AgingRow {
  invoiceId: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  daysPastDue: number;
  status: string;
}

export interface AgingTotals {
  currentMinor: number;
  d1_30Minor: number;
  d31_60Minor: number;
  d61_90Minor: number;
  d90PlusMinor: number;
  totalMinor: number;
}

export interface ArAging {
  asOf: string;
  customers: ({ customerId: string; customerName: string; customerLegalName: string; invoices: AgingRow[] } & AgingTotals)[];
  totals: AgingTotals;
}

/* -------------------------------------------- Phase 4: purchasing */

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  supplier?: { id: string; displayName: string; legalName: string } | null;
  status: string;
  currency: string;
  expectedDate?: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  notes?: string | null;
  lines: (DocLine & { quantityOrdered: number; quantityReceived: number; unitCostMinor: number })[];
}

export interface SupplierInvoice {
  id: string;
  number: string;
  supplierId: string;
  supplier?: { id: string; displayName: string; legalName: string } | null;
  purchaseOrderId?: string | null;
  purchaseOrder?: { id: string; number: string } | null;
  status: string;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  journalEntryId?: string | null;
  notes?: string | null;
  lines: (DocLine & { unitCostMinor: number; purchaseOrderLineId?: string | null })[];
  allocations?: { id: string; paymentId: string; amountMinor: number }[];
}

export interface SupplierPayment {
  id: string;
  number: string;
  supplierId: string;
  supplier?: { id: string; displayName: string; legalName: string } | null;
  method: string;
  reference?: string | null;
  paymentDate: string;
  currency: string;
  amountMinor: number;
  journalEntryId?: string | null;
  allocations: { id: string; invoiceId: string; amountMinor: number; invoice?: { id: string; number: string; totalMinor: number; paidMinor: number; status: string } }[];
}

export interface ApAging {
  asOf: string;
  suppliers: ({ supplierId: string; supplierName: string; supplierLegalName: string; invoices: AgingRow[] } & AgingTotals)[];
  totals: AgingTotals;
}

/* ------------------------------------------------- Phase 5 — Inventory */

export interface StockLevel {
  id: string;
  warehouseId: string;
  itemId: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
  averageCostMinor: number;
  lastCostMinor: number;
  currency: string;
  warehouse?: { id: string; code?: string | null; name: string } | null;
  item?: { id: string; sku: string; name: string; reorderPoint: number; costingMethod: string } | null;
}

export interface StockMovement {
  id: string;
  type: string;
  itemId: string;
  warehouseId: string;
  destinationWarehouseId?: string | null;
  quantity: number;
  unitCostMinor: number;
  totalCostMinor: number;
  currency: string;
  sourceType: string;
  sourceId?: string | null;
  reference?: string | null;
  movementDate: string;
  item?: { id: string; sku: string; name: string } | null;
  warehouse?: { id: string; code?: string | null; name: string } | null;
  destinationWarehouse?: { id: string; code?: string | null; name: string } | null;
}

export interface DocLineBase {
  id: string;
  itemId: string;
  lineOrder: number;
  item?: { id: string; sku: string; name: string } | null;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  purchaseOrderId: string;
  warehouseId: string;
  status: string;
  receiptDate: string;
  currency: string;
  subtotalMinor: number;
  totalCostMinor: number;
  journalEntryId?: string | null;
  purchaseOrder?: { id: string; number: string } | null;
  warehouse?: { id: string; code?: string | null; name: string } | null;
  lines: (DocLineBase & { purchaseOrderLineId: string; quantityReceived: number; unitCostMinor: number; lineTotalMinor: number })[];
}

export interface DeliveryNote {
  id: string;
  number: string;
  salesOrderId: string;
  warehouseId: string;
  status: string;
  deliveryDate: string;
  currency: string;
  totalCostMinor: number;
  journalEntryId?: string | null;
  salesOrder?: { id: string; number: string } | null;
  warehouse?: { id: string; code?: string | null; name: string } | null;
  lines: (DocLineBase & { salesOrderLineId: string; quantity: number; unitCostMinor: number; lineTotalMinor: number })[];
}

export interface StockAdjustment {
  id: string;
  number: string;
  warehouseId: string;
  status: string;
  adjustmentDate: string;
  currency: string;
  totalValueMinor: number;
  journalEntryId?: string | null;
  warehouse?: { id: string; code?: string | null; name: string } | null;
  lines: (DocLineBase & { quantityDelta: number; unitCostMinor: number; lineTotalMinor: number; reason: string })[];
}

export interface StockTransfer {
  id: string;
  number: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: string;
  transferDate: string;
  currency: string;
  totalCostMinor: number;
  fromWarehouse?: { id: string; code?: string | null; name: string } | null;
  toWarehouse?: { id: string; code?: string | null; name: string } | null;
  lines: (DocLineBase & { quantity: number; unitCostMinor: number; lineTotalMinor: number })[];
}

export interface StockCount {
  id: string;
  number: string;
  warehouseId: string;
  status: string;
  countDate: string;
  currency: string;
  journalEntryId?: string | null;
  warehouse?: { id: string; code?: string | null; name: string } | null;
  lines: (DocLineBase & { systemQuantity: number; countedQuantity: number; varianceQuantity: number; unitCostMinor: number })[];
}

/* ------------------------------------------------------- Phase 6 — POS */

export interface PosTerminal {
  id: string;
  code: string;
  name: string;
  branchId: string;
  warehouseId: string;
  status: string;
  cashAccountCode: string;
  cardAccountCode: string;
  branch?: { id: string; code?: string | null; name: string } | null;
  warehouse?: { id: string; code?: string | null; name: string } | null;
}

export interface PosShift {
  id: string;
  terminalId: string;
  cashierId: string;
  openedAt: string;
  openingFloatMinor: number;
  status: string;
  closedAt?: string | null;
  expectedCashMinor: number;
  expectedCardMinor: number;
  countedCashMinor?: number | null;
  varianceMinor: number;
  closedBy?: string | null;
  journalEntryId?: string | null;
  terminal?: { id: string; code: string; name: string } | null;
}

export interface PosSale {
  id: string;
  number: string;
  terminalId: string;
  shiftId: string;
  cashierId: string;
  customerId?: string | null;
  status: string;
  saleDate: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  cashMinor: number;
  cardMinor: number;
  cogsMinor: number;
  journalEntryId?: string | null;
  terminal?: { id: string; code: string; name: string } | null;
  lines: (DocLineBase & { quantity: number; unitPriceMinor: number; discountPct: number; taxRateBps: number; unitCostMinor: number; lineSubtotalMinor: number; lineTaxMinor: number; lineTotalMinor: number })[];
  payments: { id: string; method: string; amountMinor: number; reference?: string | null }[];
}

export interface PosLookup {
  item: { id: string; sku: string; barcode?: string | null; name: string; nameAr?: string | null; salesPriceMinor: number; taxRateBps: number; costingMethod: string; trackStock: boolean };
  priceMinor: number;
  taxRateBps: number;
  warehouseId: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
}

export interface ZReport {
  shift: { id: string; terminal: { id: string; code: string; name: string }; cashierId: string; status: string; openedAt: string; closedAt?: string | null; openingFloatMinor: number };
  salesCount: number;
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  cashMinor: number;
  cardMinor: number;
  expectedCashMinor: number;
  expectedCardMinor: number;
  countedCashMinor?: number | null;
  varianceMinor?: number | null;
  sales: PosSale[];
}

/* ------------------------------------------------- Phase 7 — Manufacturing */

export interface WorkCenter {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  standardCostRateMinor: number;
  status: string;
}

export interface BomLine {
  id: string;
  componentItemId: string;
  componentItem?: { id: string; sku: string; name: string; standardCostMinor: number } | null;
  quantityPerUnit: number;
  scrapBps: number;
  workCenterId?: string | null;
  workCenter?: { id: string; code: string; name: string } | null;
  operationName?: string | null;
  lineOrder: number;
  lineCostMinor?: number;
}

export interface Bom {
  id: string;
  finishedItemId: string;
  finishedItem?: { id: string; sku: string; name: string; standardCostMinor: number } | null;
  version: number;
  status: string;
  lines: BomLine[];
  standardCostMinor: number;
}

export interface BomCost {
  bomId: string;
  finishedItemId: string;
  version: number;
  status: string;
  standardCostMinor: number;
  lines: { id: string; componentItemId: string; quantityPerUnit: number; scrapBps: number; lineCostMinor: number }[];
}

export interface WorkOrderLine {
  id: string;
  componentItemId: string;
  componentItem?: { id: string; sku: string; name: string } | null;
  quantityPerUnit: number;
  scrapBps: number;
  workCenterId?: string | null;
  workCenter?: { id: string; code: string; name: string } | null;
  operationName?: string | null;
  qtyRequired: number;
  qtyIssued: number;
  lineOrder: number;
}

export interface WorkOrderOperation {
  id: string;
  name: string;
  workCenterId?: string | null;
  workCenter?: { id: string; code: string; name: string } | null;
  plannedHours: number;
  actualHours?: number | null;
  status: string;
}

export interface WorkOrderVariance {
  plannedMaterialCostMinor: number;
  actualMaterialCostMinor: number;
  varianceMinor: number;
}

export interface WorkOrder {
  id: string;
  number: string;
  finishedItemId: string;
  finishedItem?: { id: string; sku: string; name: string } | null;
  bomId: string;
  bomVersion: number;
  warehouseId: string;
  warehouse?: { id: string; code: string; name: string } | null;
  status: string;
  qtyPlanned: number;
  qtyProduced: number;
  qtyScrapped: number;
  plannedStartDate?: string | null;
  dueDate?: string | null;
  materialCostPlannedMinor: number;
  materialCostActualMinor: number;
  completionPct: number;
  overProduced?: boolean;
  lines: WorkOrderLine[];
  operations: WorkOrderOperation[];
  materialIssuedMinor?: number;
  productionReceivedMinor?: number;
  finishedScrapMinor?: number;
  wipBalanceMinor?: number;
  variance?: WorkOrderVariance;
}

export interface MaterialIssueLine {
  id: string;
  workOrderLineId: string;
  itemId: string;
  item?: { id: string; sku: string; name: string } | null;
  quantity: number;
  unitCostMinor: number;
  lineTotalMinor: number;
}

export interface MaterialIssue {
  id: string;
  number: string;
  workOrderId: string;
  workOrder?: { id: string; number: string } | null;
  warehouseId: string;
  warehouse?: { id: string; code: string; name: string } | null;
  status: string;
  issueDate: string;
  currency: string;
  totalCostMinor: number;
  journalEntryId?: string | null;
  lines: MaterialIssueLine[];
}

export interface ProductionReceipt {
  id: string;
  number: string;
  workOrderId: string;
  workOrder?: { id: string; number: string } | null;
  warehouseId: string;
  warehouse?: { id: string; code: string; name: string } | null;
  status: string;
  receiptDate: string;
  quantity: number;
  unitCostMinor: number;
  totalCostMinor: number;
  overProduced: boolean;
  currency: string;
  journalEntryId?: string | null;
}

export interface Scrap {
  id: string;
  number: string;
  workOrderId?: string | null;
  workOrder?: { id: string; number: string } | null;
  kind: string;
  itemId: string;
  item?: { id: string; sku: string; name: string } | null;
  warehouseId: string;
  warehouse?: { id: string; code: string; name: string } | null;
  quantity: number;
  reason: string;
  scrapDate: string;
  status: string;
  unitCostMinor: number;
  totalCostMinor: number;
  currency: string;
  journalEntryId?: string | null;
}

export interface WipRow {
  workOrderId: string;
  workOrderNumber: string;
  finishedItem: { id: string; sku: string; name: string };
  status: string;
  qtyPlanned: number;
  qtyProduced: number;
  materialIssuedMinor: number;
  productionReceivedMinor: number;
  finishedScrapMinor: number;
  wipBalanceMinor: number;
  completionPct: number;
}

/* ------------------------------------------------------ Phase 8 — HR/Payroll */

export interface Department {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  parentId?: string | null;
  parent?: { id: string; code: string; name: string } | null;
  managerId?: string | null;
  manager?: { id: string; code: string; name: string } | null;
  status: string;
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  nationalId?: string | null;
  jobTitle: string;
  departmentId: string;
  department?: { id: string; code: string; name: string } | null;
  branchId?: string | null;
  branch?: { id: string; code: string; name: string } | null;
  hireDate: string;
  endDate?: string | null;
  status: string;
  basicSalaryMinor: number;
  housingAllowanceMinor: number;
  transportAllowanceMinor: number;
  otherAllowanceMinor: number;
  currency: string;
  bankName?: string | null;
  iban?: string | null;
  gosiNumber?: string | null;
  nationality: string;
  dependents: number;
  userId?: string | null;
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  daysPerYear: number;
  paid: boolean;
  status: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee?: { id: string; code: string; name: string } | null;
  leaveTypeId: string;
  leaveType?: { id: string; code: string; name: string } | null;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  approverId?: string | null;
}

export interface LeaveBalanceRow {
  leaveType: { id: string; code: string; name: string };
  entitlement: number;
  approvedDaysTaken: number;
  balance: number;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employee?: { id: string; code: string; name: string } | null;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  status: string;
  notes?: string | null;
}

export interface AttendanceSummaryRow {
  employee: { id: string; code: string; name: string };
  workingDays: number;
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  holiday: number;
}

export interface PayrollLine {
  id: string;
  employeeId: string;
  employee?: { id: string; code: string; name: string } | null;
  basicSalaryMinor: number;
  allowancesMinor: number;
  overtimeMinor: number;
  absentDays: number;
  grossMinor: number;
  gosiEmployeeMinor: number;
  otherDeductionsMinor: number;
  netMinor: number;
  gosiEmployerMinor: number;
  eosbAccrualMinor: number;
  workingDays: number;
}

export interface PayrollRun {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  currency: string;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  gosiEmployerMinor: number;
  eosbMinor: number;
  journalEntryId?: string | null;
  paymentJournalEntryId?: string | null;
  lines: PayrollLine[];
}

/* Phase 9 — Projects */
export interface Project {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  customerId?: string | null;
  managerId?: string | null;
  status: string;
  startDate?: string | null;
  dueDate?: string | null;
  budgetMinor: number;
  currency: string;
  billingType: string;
  description?: string | null;
  customer?: { id: string; displayName: string; legalName: string } | null;
  manager?: { id: string; email: string; firstName?: string | null; lastName?: string | null } | null;
  _count?: { tasks: number; timesheets: number; expenses: number; milestones: number };
  tasks?: ProjectTask[];
  milestones?: Milestone[];
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  assigneeId?: string | null;
  status: string;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  estimatedHours?: number | null;
  hourlyRateMinor?: number | null;
  priority: string;
  actualMinutes?: number;
  actualHours?: number;
  assignee?: { id: string; code: string; name: string } | null;
  project?: { id: string; code: string; name: string; status: string } | null;
}

export interface Timesheet {
  id: string;
  employeeId: string;
  projectId: string;
  taskId?: string | null;
  date: string;
  minutesInt: number;
  hours: number;
  billable: boolean;
  description?: string | null;
  status: string;
  approverId?: string | null;
  employee?: { id: string; code: string; name: string } | null;
  project?: { id: string; code: string; name: string; status: string } | null;
  task?: { id: string; title: string } | null;
}

export interface ProjectExpense {
  id: string;
  projectId: string;
  date: string;
  category: string;
  amountMinor: number;
  currency: string;
  description?: string | null;
  receiptFileId?: string | null;
  status: string;
  project?: { id: string; code: string; name: string; status: string } | null;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  dueDate?: string | null;
  amountMinor: number;
  status: string;
  invoiceId?: string | null;
  project?: { id: string; code: string; name: string; billingType: string; currency: string } | null;
  invoice?: { id: string; number: string; status: string; totalMinor: number } | null;
}

export interface ProjectCosting {
  project: { id: string; code: string; name: string; status: string; billingType: string; currency: string };
  budgetMinor: number;
  labourMinor: number;
  expensesMinor: number;
  materialsMinor: number;
  actualMinor: number;
  remainingMinor: number;
  revenueMinor: number;
  profitMinor: number;
  marginBps: number | null;
  percentUsedBps: number | null;
  elapsedDays: number;
  plannedDays: number | null;
  burnRateMinorPerDay: number;
  projectedTotalMinor: number | null;
  projectedOverrunMinor: number | null;
  labourByEmployee: { employeeId: string; code: string; name: string; minutes: number; costMinor: number }[];
  labourByTask: { taskId: string | null; title: string | null; minutes: number; costMinor: number }[];
  expensesByCategory: { category: string; amountMinor: number }[];
  revenueInvoices: { id: string; number: string; status: string; totalMinor: number }[];
}

/* Phase 10 — Analytics / AI */
export interface DashboardKpis {
  period: { year: number; month: number };
  revenueMinor: number;
  previousRevenueMinor: number;
  revenueTrendBps: number | null;
  grossProfitMinor: number;
  grossMarginBps: number | null;
  previousGrossMarginBps: number | null;
  netIncomeMinor: number;
  openArMinor: number;
  overdueArMinor: number;
  openApMinor: number;
  overdueApMinor: number;
  stockValueMinor: number;
  lowStockCount: number;
  openPurchaseOrdersMinor: number;
  payrollCostMinor: number;
  salesByMonth: { month: string; revenueMinor: number }[];
  topCustomers: { customerId: string; name: string; revenueMinor: number }[];
  topItems: { itemId: string; sku: string; name: string; revenueMinor: number }[];
}

export interface ProfitLoss {
  revenueMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  operatingExpensesMinor: number;
  netIncomeMinor: number;
  grossMarginBps: number | null;
  netMarginBps: number | null;
  accounts: { accountCode: string; accountName: string; accountType: string; debitMinor: number; creditMinor: number }[];
}

export interface BalanceSheet {
  assetsMinor: number;
  liabilitiesMinor: number;
  equityMinor: number;
  netIncomeMinor: number;
  totalLiabilitiesEquityMinor: number;
  differenceMinor: number;
  balanced: boolean;
  accounts: { accountCode: string; accountName: string; accountType: string; netDebitMinor: number }[];
}

export interface CashFlow {
  netIncomeMinor: number;
  operatingMinor: number;
  investingMinor: number;
  financingMinor: number;
  netChangeInCashMinor: number;
  actualCashChangeMinor: number;
  openingCashMinor: number;
  closingCashMinor: number;
  differenceMinor: number;
  balanced: boolean;
}

export interface ReportSnapshot {
  id: string;
  type: string;
  parameters: Record<string, unknown>;
  format: string;
  content?: Record<string, unknown> | null;
  fileAssetId?: string | null;
  generatedBy?: string | null;
  generatedAt: string;
}

export interface AiInsight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  source: string;
}

export interface AiInsightsResponse {
  source: string;
  insights: AiInsight[];
  summary: string;
}

/** Phase 11 — integrations. */
export interface ZatcaDocument {
  id: string;
  invoiceId: string;
  type: string;
  uuid: string;
  xml: string;
  invoiceHash: string;
  previousHash?: string | null;
  qrData: string;
  status: string;
  zatcaResponse?: Record<string, unknown> | null;
  submittedAt?: string | null;
  createdAt: string;
  invoice?: { id: string; number: string; totalMinor: number; currency: string } | null;
}

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  status: string;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  attemptCount: number;
  status: string;
  lastStatusCode?: number | null;
  lastResponse?: string | null;
  nextRetryAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  endpoint?: { id: string; name: string; url: string } | null;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  status: string;
  createdAt: string;
  /** Present only in the create response — shown once, never stored. */
  apiKey?: string;
}

export interface ExportJob {
  id: string;
  type: string;
  format: string;
  status: string;
  rowCount: number;
  fileAssetId?: string | null;
  createdAt: string;
}

export interface ProviderStatus {
  payment: { provider: string; simulated: boolean; configured: boolean; configuredGateways: string[]; note: string };
  sms: { provider: string; simulated: boolean; configured: boolean; note: string };
  zatca: { mode: string; configured: boolean; note: string };
  ai: { provider: string; simulated: boolean; note: string };
}
