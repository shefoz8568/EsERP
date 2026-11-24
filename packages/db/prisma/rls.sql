-- EsERP Row-Level Security (RLS) — Phase 0
-- Every tenant-scoped table is isolated by app.tenant_id, a session-local
-- setting applied by @eserp/db withTenant()/setTenantContext() inside a
-- transaction (SET LOCAL). The API sets it from the JWT tenantId claim;
-- RLS is the backstop: even a bug that forgets the tenant filter cannot
-- leak another tenant's rows, because Postgres enforces it.
-- Tenant itself is NOT tenant-scoped (it is the tenant registry).
-- Permission is a global catalog (seeded once, name unique) and is also
-- excluded; RolePermission carries the tenantId instead.
--
-- One narrow escape exists: app.bootstrap = 'eserp-login'. It is set ONLY
-- by server code (withBootstrap in @eserp/db) inside a transaction, for the
-- pre-authentication lookups that cannot yet know a tenant (login by email,
-- OAuth linking, the outbox drain worker). It is never derived from user
-- input and never set on a request-scoped transaction.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Role";
CREATE POLICY tenant_isolation ON "Role" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RolePermission";
CREATE POLICY tenant_isolation ON "RolePermission" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "UserRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UserRole";
CREATE POLICY tenant_isolation ON "UserRole" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RefreshToken";
CREATE POLICY tenant_isolation ON "RefreshToken" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "MfaSecret" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MfaSecret" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MfaSecret";
CREATE POLICY tenant_isolation ON "MfaSecret" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "CompanyProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CompanyProfile";
CREATE POLICY tenant_isolation ON "CompanyProfile" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Currency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Currency" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Currency";
CREATE POLICY tenant_isolation ON "Currency" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ExchangeRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExchangeRate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExchangeRate";
CREATE POLICY tenant_isolation ON "ExchangeRate" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "TaxRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxRate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TaxRate";
CREATE POLICY tenant_isolation ON "TaxRate" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "UnitOfMeasure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnitOfMeasure" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UnitOfMeasure";
CREATE POLICY tenant_isolation ON "UnitOfMeasure" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "UomConversion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UomConversion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UomConversion";
CREATE POLICY tenant_isolation ON "UomConversion" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "NumberingSeries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NumberingSeries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NumberingSeries";
CREATE POLICY tenant_isolation ON "NumberingSeries" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Warehouse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Warehouse" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Warehouse";
CREATE POLICY tenant_isolation ON "Warehouse" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Branch";
CREATE POLICY tenant_isolation ON "Branch" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ChartOfAccounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChartOfAccounts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChartOfAccounts";
CREATE POLICY tenant_isolation ON "ChartOfAccounts" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notification";
CREATE POLICY tenant_isolation ON "Notification" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invitation";
CREATE POLICY tenant_isolation ON "Invitation" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "OnboardingState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingState" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OnboardingState";
CREATE POLICY tenant_isolation ON "OnboardingState" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "FileAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FileAsset" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FileAsset";
CREATE POLICY tenant_isolation ON "FileAsset" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OutboxEvent";
CREATE POLICY tenant_isolation ON "OutboxEvent" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 1 — Master Data (Contact, ItemCategory, Item, PriceList, PriceListItem).
-- Same tenant_isolation policy as Phase 0, including the bootstrap escape.

ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Contact";
CREATE POLICY tenant_isolation ON "Contact" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ItemCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItemCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ItemCategory";
CREATE POLICY tenant_isolation ON "ItemCategory" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Item" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Item";
CREATE POLICY tenant_isolation ON "Item" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PriceList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceList" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PriceList";
CREATE POLICY tenant_isolation ON "PriceList" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PriceListItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceListItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PriceListItem";
CREATE POLICY tenant_isolation ON "PriceListItem" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 2 — Accounting (FiscalPeriod, CostCenter, OpeningBalance,
-- JournalEntry, JournalEntryLine). Same tenant_isolation policy as
-- Phase 0/1, including the bootstrap escape.

ALTER TABLE "FiscalPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalPeriod" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalPeriod";
CREATE POLICY tenant_isolation ON "FiscalPeriod" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "CostCenter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CostCenter" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CostCenter";
CREATE POLICY tenant_isolation ON "CostCenter" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "OpeningBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpeningBalance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OpeningBalance";
CREATE POLICY tenant_isolation ON "OpeningBalance" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JournalEntry";
CREATE POLICY tenant_isolation ON "JournalEntry" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "JournalEntryLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntryLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "JournalEntryLine";
CREATE POLICY tenant_isolation ON "JournalEntryLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 3 RLS (see prisma/rls.sql)
-- Phase 3 — Sales / CRM (Lead, Opportunity, SalesQuote, QuoteLine,
-- SalesOrder, OrderLine, SalesInvoice, SalesInvoiceLine, CustomerPayment,
-- CustomerPaymentAllocation). Same tenant_isolation policy as Phase 0/1/2,
-- including the bootstrap escape.

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Lead";
CREATE POLICY tenant_isolation ON "Lead" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Opportunity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Opportunity";
CREATE POLICY tenant_isolation ON "Opportunity" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SalesQuote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesQuote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalesQuote";
CREATE POLICY tenant_isolation ON "SalesQuote" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "QuoteLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QuoteLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "QuoteLine";
CREATE POLICY tenant_isolation ON "QuoteLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SalesOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesOrder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalesOrder";
CREATE POLICY tenant_isolation ON "SalesOrder" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "OrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OrderLine";
CREATE POLICY tenant_isolation ON "OrderLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SalesInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesInvoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalesInvoice";
CREATE POLICY tenant_isolation ON "SalesInvoice" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SalesInvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesInvoiceLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SalesInvoiceLine";
CREATE POLICY tenant_isolation ON "SalesInvoiceLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "CustomerPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CustomerPayment";
CREATE POLICY tenant_isolation ON "CustomerPayment" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "CustomerPaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPaymentAllocation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CustomerPaymentAllocation";
CREATE POLICY tenant_isolation ON "CustomerPaymentAllocation" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 4 RLS (see prisma/rls.sql)
-- Phase 4 — Purchasing (PurchaseOrder, PurchaseOrderLine, SupplierInvoice,
-- SupplierInvoiceLine, SupplierPayment, SupplierPaymentAllocation). Same
-- tenant_isolation policy as Phase 0/1/2/3, including the bootstrap escape.

ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PurchaseOrder";
CREATE POLICY tenant_isolation ON "PurchaseOrder" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PurchaseOrderLine";
CREATE POLICY tenant_isolation ON "PurchaseOrderLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SupplierInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierInvoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupplierInvoice";
CREATE POLICY tenant_isolation ON "SupplierInvoice" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SupplierInvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierInvoiceLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupplierInvoiceLine";
CREATE POLICY tenant_isolation ON "SupplierInvoiceLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SupplierPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierPayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupplierPayment";
CREATE POLICY tenant_isolation ON "SupplierPayment" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "SupplierPaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierPaymentAllocation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SupplierPaymentAllocation";
CREATE POLICY tenant_isolation ON "SupplierPaymentAllocation" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 5 RLS (see prisma/rls.sql)
-- Phase 5 — Inventory (StockLevel, StockCostLayer, StockMovement, GoodsReceipt, GoodsReceiptLine, DeliveryNote, DeliveryNoteLine, StockAdjustment, StockAdjustmentLine, StockTransfer, StockTransferLine, StockCount, StockCountLine). Same
-- tenant_isolation policy as Phase 0/1/2/3/4, including the bootstrap escape.

ALTER TABLE "StockLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLevel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockLevel";
CREATE POLICY tenant_isolation ON "StockLevel" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockCostLayer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCostLayer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockCostLayer";
CREATE POLICY tenant_isolation ON "StockCostLayer" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockMovement";
CREATE POLICY tenant_isolation ON "StockMovement" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "GoodsReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoodsReceipt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GoodsReceipt";
CREATE POLICY tenant_isolation ON "GoodsReceipt" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "GoodsReceiptLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoodsReceiptLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GoodsReceiptLine";
CREATE POLICY tenant_isolation ON "GoodsReceiptLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "DeliveryNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeliveryNote";
CREATE POLICY tenant_isolation ON "DeliveryNote" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "DeliveryNoteLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryNoteLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeliveryNoteLine";
CREATE POLICY tenant_isolation ON "DeliveryNoteLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockAdjustment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockAdjustment";
CREATE POLICY tenant_isolation ON "StockAdjustment" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockAdjustmentLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockAdjustmentLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockAdjustmentLine";
CREATE POLICY tenant_isolation ON "StockAdjustmentLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockTransfer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockTransfer";
CREATE POLICY tenant_isolation ON "StockTransfer" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockTransferLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockTransferLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockTransferLine";
CREATE POLICY tenant_isolation ON "StockTransferLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCount" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockCount";
CREATE POLICY tenant_isolation ON "StockCount" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "StockCountLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCountLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockCountLine";
CREATE POLICY tenant_isolation ON "StockCountLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 6 RLS (see prisma/rls.sql)
-- Phase 6 — POS (PosTerminal, PosShift, PosSale, PosSaleLine, PosSalePayment). Same
-- tenant_isolation policy as Phase 0/1/2/3/4, including the bootstrap escape.

ALTER TABLE "PosTerminal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosTerminal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PosTerminal";
CREATE POLICY tenant_isolation ON "PosTerminal" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PosShift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosShift" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PosShift";
CREATE POLICY tenant_isolation ON "PosShift" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PosSale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosSale" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PosSale";
CREATE POLICY tenant_isolation ON "PosSale" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PosSaleLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosSaleLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PosSaleLine";
CREATE POLICY tenant_isolation ON "PosSaleLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PosSalePayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosSalePayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PosSalePayment";
CREATE POLICY tenant_isolation ON "PosSalePayment" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 7 RLS (see prisma/rls.sql)
-- Phase 7 — Manufacturing (WorkCenter, Bom, BomLine, WorkOrder, WorkOrderLine,
-- WorkOrderOperation, MaterialIssue, MaterialIssueLine, ProductionReceipt, Scrap).
-- Same tenant_isolation policy as Phase 0/1/2/3/4/5/6, including the bootstrap escape.

ALTER TABLE "WorkCenter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkCenter" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkCenter";
CREATE POLICY tenant_isolation ON "WorkCenter" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Bom" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Bom" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Bom";
CREATE POLICY tenant_isolation ON "Bom" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "BomLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BomLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BomLine";
CREATE POLICY tenant_isolation ON "BomLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "WorkOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkOrder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkOrder";
CREATE POLICY tenant_isolation ON "WorkOrder" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "WorkOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkOrderLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkOrderLine";
CREATE POLICY tenant_isolation ON "WorkOrderLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "WorkOrderOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkOrderOperation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkOrderOperation";
CREATE POLICY tenant_isolation ON "WorkOrderOperation" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "MaterialIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaterialIssue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MaterialIssue";
CREATE POLICY tenant_isolation ON "MaterialIssue" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "MaterialIssueLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaterialIssueLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MaterialIssueLine";
CREATE POLICY tenant_isolation ON "MaterialIssueLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ProductionReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductionReceipt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProductionReceipt";
CREATE POLICY tenant_isolation ON "ProductionReceipt" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Scrap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Scrap" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Scrap";
CREATE POLICY tenant_isolation ON "Scrap" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 8 RLS (see prisma/rls.sql)
-- Phase 8 — HR / Payroll (Department, Employee, LeaveType, LeaveRequest,
-- AttendanceRecord, PayrollRun, PayrollLine). Same tenant_isolation policy as
-- Phase 0/1/2/3/4/5/6/7, including the bootstrap escape.

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Department";
CREATE POLICY tenant_isolation ON "Department" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Employee";
CREATE POLICY tenant_isolation ON "Employee" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "LeaveType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveType" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaveType";
CREATE POLICY tenant_isolation ON "LeaveType" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaveRequest";
CREATE POLICY tenant_isolation ON "LeaveRequest" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceRecord";
CREATE POLICY tenant_isolation ON "AttendanceRecord" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollRun";
CREATE POLICY tenant_isolation ON "PayrollRun" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "PayrollLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayrollLine";
CREATE POLICY tenant_isolation ON "PayrollLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 9 RLS (see prisma/rls.sql)
-- Phase 9 — Projects (Project, ProjectTask, Timesheet, ProjectExpense,
-- Milestone). Same tenant_isolation policy as Phase 0–8, including the
-- bootstrap escape.

ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Project";
CREATE POLICY tenant_isolation ON "Project" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ProjectTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectTask" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProjectTask";
CREATE POLICY tenant_isolation ON "ProjectTask" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Timesheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Timesheet" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Timesheet";
CREATE POLICY tenant_isolation ON "Timesheet" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ProjectExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectExpense" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProjectExpense";
CREATE POLICY tenant_isolation ON "ProjectExpense" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "Milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Milestone" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Milestone";
CREATE POLICY tenant_isolation ON "Milestone" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 10 RLS (see prisma/rls.sql)
-- Phase 10 — Analytics / AI (ReportSnapshot only). Same tenant_isolation
-- policy as Phase 0–9, including the bootstrap escape.

ALTER TABLE "ReportSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportSnapshot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReportSnapshot";
CREATE POLICY tenant_isolation ON "ReportSnapshot" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

-- Phase 11 — Integrations (ZatcaDocument, WebhookEndpoint, WebhookDelivery, ApiKey, ExportJob). Same tenant_isolation policy as every other tenant table.
-- Phase 11 RLS (see prisma/rls.sql)
ALTER TABLE "ZatcaDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ZatcaDocument" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ZatcaDocument";
CREATE POLICY tenant_isolation ON "ZatcaDocument" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WebhookEndpoint";
CREATE POLICY tenant_isolation ON "WebhookEndpoint" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WebhookDelivery";
CREATE POLICY tenant_isolation ON "WebhookDelivery" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ApiKey";
CREATE POLICY tenant_isolation ON "ApiKey" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');

ALTER TABLE "ExportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExportJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExportJob";
CREATE POLICY tenant_isolation ON "ExportJob" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bootstrap', true) = 'eserp-login');
