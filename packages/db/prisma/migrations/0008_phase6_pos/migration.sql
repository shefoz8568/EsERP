-- CreateTable
CREATE TABLE "PosTerminal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cashAccountCode" TEXT NOT NULL DEFAULT '1010',
    "cardAccountCode" TEXT NOT NULL DEFAULT '1030',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PosTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloatMinor" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "expectedCashMinor" BIGINT NOT NULL DEFAULT 0,
    "expectedCardMinor" BIGINT NOT NULL DEFAULT 0,
    "countedCashMinor" BIGINT,
    "varianceMinor" BIGINT NOT NULL DEFAULT 0,
    "closedBy" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "cashMinor" BIGINT NOT NULL DEFAULT 0,
    "cardMinor" BIGINT NOT NULL DEFAULT 0,
    "cogsMinor" BIGINT NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSaleLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "posSaleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL DEFAULT 0,
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER NOT NULL DEFAULT 1500,
    "unitCostMinor" BIGINT NOT NULL DEFAULT 0,
    "lineSubtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "lineDiscountMinor" BIGINT NOT NULL DEFAULT 0,
    "lineTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "lineTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PosSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSalePayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "posSaleId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PosSalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosTerminal_tenantId_idx" ON "PosTerminal"("tenantId");

-- CreateIndex
CREATE INDEX "PosTerminal_branchId_idx" ON "PosTerminal"("branchId");

-- CreateIndex
CREATE INDEX "PosTerminal_warehouseId_idx" ON "PosTerminal"("warehouseId");

-- CreateIndex
CREATE INDEX "PosTerminal_status_idx" ON "PosTerminal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PosTerminal_code_tenantId_key" ON "PosTerminal"("code", "tenantId");

-- CreateIndex
CREATE INDEX "PosShift_tenantId_idx" ON "PosShift"("tenantId");

-- CreateIndex
CREATE INDEX "PosShift_terminalId_idx" ON "PosShift"("terminalId");

-- CreateIndex
CREATE INDEX "PosShift_status_idx" ON "PosShift"("status");

-- CreateIndex
CREATE INDEX "PosShift_cashierId_idx" ON "PosShift"("cashierId");

-- CreateIndex
CREATE INDEX "PosSale_tenantId_idx" ON "PosSale"("tenantId");

-- CreateIndex
CREATE INDEX "PosSale_terminalId_idx" ON "PosSale"("terminalId");

-- CreateIndex
CREATE INDEX "PosSale_shiftId_idx" ON "PosSale"("shiftId");

-- CreateIndex
CREATE INDEX "PosSale_status_idx" ON "PosSale"("status");

-- CreateIndex
CREATE INDEX "PosSale_saleDate_idx" ON "PosSale"("saleDate");

-- CreateIndex
CREATE UNIQUE INDEX "PosSale_number_tenantId_key" ON "PosSale"("number", "tenantId");

-- CreateIndex
CREATE INDEX "PosSaleLine_tenantId_idx" ON "PosSaleLine"("tenantId");

-- CreateIndex
CREATE INDEX "PosSaleLine_posSaleId_idx" ON "PosSaleLine"("posSaleId");

-- CreateIndex
CREATE INDEX "PosSaleLine_itemId_idx" ON "PosSaleLine"("itemId");

-- CreateIndex
CREATE INDEX "PosSalePayment_tenantId_idx" ON "PosSalePayment"("tenantId");

-- CreateIndex
CREATE INDEX "PosSalePayment_posSaleId_idx" ON "PosSalePayment"("posSaleId");

-- AddForeignKey
ALTER TABLE "PosTerminal" ADD CONSTRAINT "PosTerminal_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTerminal" ADD CONSTRAINT "PosTerminal_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PosTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "PosTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_posSaleId_fkey" FOREIGN KEY ("posSaleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSalePayment" ADD CONSTRAINT "PosSalePayment_posSaleId_fkey" FOREIGN KEY ("posSaleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
