-- CreateTable
CREATE TABLE "WorkCenter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "standardCostRateMinor" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "WorkCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bom" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "finishedItemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "name" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "Bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "quantityPerUnit" BIGINT NOT NULL,
    "scrapBps" INTEGER NOT NULL DEFAULT 0,
    "workCenterId" TEXT,
    "operationName" TEXT,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "finishedItemId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "bomVersion" INTEGER NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "qtyPlanned" BIGINT NOT NULL,
    "qtyProduced" BIGINT NOT NULL DEFAULT 0,
    "qtyScrapped" BIGINT NOT NULL DEFAULT 0,
    "plannedStartDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "materialCostPlannedMinor" BIGINT NOT NULL DEFAULT 0,
    "materialCostActualMinor" BIGINT NOT NULL DEFAULT 0,
    "unitCostMinor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "quantityPerUnit" BIGINT NOT NULL,
    "scrapBps" INTEGER NOT NULL DEFAULT 0,
    "workCenterId" TEXT,
    "operationName" TEXT,
    "qtyRequired" BIGINT NOT NULL,
    "qtyIssued" BIGINT NOT NULL DEFAULT 0,
    "unitCostMinor" BIGINT NOT NULL DEFAULT 0,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "WorkOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderOperation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workCenterId" TEXT,
    "plannedHours" INTEGER NOT NULL DEFAULT 0,
    "actualHours" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "WorkOrderOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "totalCostMinor" BIGINT NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "MaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssueLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "materialIssueId" TEXT NOT NULL,
    "workOrderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unitCostMinor" BIGINT NOT NULL DEFAULT 0,
    "lineTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "MaterialIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" BIGINT NOT NULL,
    "unitCostMinor" BIGINT NOT NULL DEFAULT 0,
    "totalCostMinor" BIGINT NOT NULL DEFAULT 0,
    "overProduced" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "ProductionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scrap" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "workOrderId" TEXT,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unitCostMinor" BIGINT NOT NULL DEFAULT 0,
    "totalCostMinor" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "scrapDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "Scrap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkCenter_tenantId_idx" ON "WorkCenter"("tenantId");

-- CreateIndex
CREATE INDEX "WorkCenter_status_idx" ON "WorkCenter"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_code_tenantId_key" ON "WorkCenter"("code", "tenantId");

-- CreateIndex
CREATE INDEX "Bom_tenantId_idx" ON "Bom"("tenantId");

-- CreateIndex
CREATE INDEX "Bom_finishedItemId_idx" ON "Bom"("finishedItemId");

-- CreateIndex
CREATE INDEX "Bom_status_idx" ON "Bom"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Bom_finishedItemId_version_tenantId_key" ON "Bom"("finishedItemId", "version", "tenantId");

-- CreateIndex
CREATE INDEX "BomLine_tenantId_idx" ON "BomLine"("tenantId");

-- CreateIndex
CREATE INDEX "BomLine_bomId_idx" ON "BomLine"("bomId");

-- CreateIndex
CREATE INDEX "BomLine_componentItemId_idx" ON "BomLine"("componentItemId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_idx" ON "WorkOrder"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrder_finishedItemId_idx" ON "WorkOrder"("finishedItemId");

-- CreateIndex
CREATE INDEX "WorkOrder_bomId_idx" ON "WorkOrder"("bomId");

-- CreateIndex
CREATE INDEX "WorkOrder_warehouseId_idx" ON "WorkOrder"("warehouseId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_number_tenantId_key" ON "WorkOrder"("number", "tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderLine_tenantId_idx" ON "WorkOrderLine"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderLine_workOrderId_idx" ON "WorkOrderLine"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderLine_componentItemId_idx" ON "WorkOrderLine"("componentItemId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_tenantId_idx" ON "WorkOrderOperation"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_workOrderId_idx" ON "WorkOrderOperation"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderOperation_workCenterId_idx" ON "WorkOrderOperation"("workCenterId");

-- CreateIndex
CREATE INDEX "MaterialIssue_tenantId_idx" ON "MaterialIssue"("tenantId");

-- CreateIndex
CREATE INDEX "MaterialIssue_workOrderId_idx" ON "MaterialIssue"("workOrderId");

-- CreateIndex
CREATE INDEX "MaterialIssue_warehouseId_idx" ON "MaterialIssue"("warehouseId");

-- CreateIndex
CREATE INDEX "MaterialIssue_status_idx" ON "MaterialIssue"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialIssue_number_tenantId_key" ON "MaterialIssue"("number", "tenantId");

-- CreateIndex
CREATE INDEX "MaterialIssueLine_tenantId_idx" ON "MaterialIssueLine"("tenantId");

-- CreateIndex
CREATE INDEX "MaterialIssueLine_materialIssueId_idx" ON "MaterialIssueLine"("materialIssueId");

-- CreateIndex
CREATE INDEX "MaterialIssueLine_workOrderLineId_idx" ON "MaterialIssueLine"("workOrderLineId");

-- CreateIndex
CREATE INDEX "MaterialIssueLine_itemId_idx" ON "MaterialIssueLine"("itemId");

-- CreateIndex
CREATE INDEX "ProductionReceipt_tenantId_idx" ON "ProductionReceipt"("tenantId");

-- CreateIndex
CREATE INDEX "ProductionReceipt_workOrderId_idx" ON "ProductionReceipt"("workOrderId");

-- CreateIndex
CREATE INDEX "ProductionReceipt_warehouseId_idx" ON "ProductionReceipt"("warehouseId");

-- CreateIndex
CREATE INDEX "ProductionReceipt_status_idx" ON "ProductionReceipt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReceipt_number_tenantId_key" ON "ProductionReceipt"("number", "tenantId");

-- CreateIndex
CREATE INDEX "Scrap_tenantId_idx" ON "Scrap"("tenantId");

-- CreateIndex
CREATE INDEX "Scrap_workOrderId_idx" ON "Scrap"("workOrderId");

-- CreateIndex
CREATE INDEX "Scrap_itemId_idx" ON "Scrap"("itemId");

-- CreateIndex
CREATE INDEX "Scrap_warehouseId_idx" ON "Scrap"("warehouseId");

-- CreateIndex
CREATE INDEX "Scrap_status_idx" ON "Scrap"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Scrap_number_tenantId_key" ON "Scrap"("number", "tenantId");

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLine" ADD CONSTRAINT "WorkOrderLine_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLine" ADD CONSTRAINT "WorkOrderLine_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLine" ADD CONSTRAINT "WorkOrderLine_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderOperation" ADD CONSTRAINT "WorkOrderOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssueLine" ADD CONSTRAINT "MaterialIssueLine_materialIssueId_fkey" FOREIGN KEY ("materialIssueId") REFERENCES "MaterialIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssueLine" ADD CONSTRAINT "MaterialIssueLine_workOrderLineId_fkey" FOREIGN KEY ("workOrderLineId") REFERENCES "WorkOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssueLine" ADD CONSTRAINT "MaterialIssueLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReceipt" ADD CONSTRAINT "ProductionReceipt_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReceipt" ADD CONSTRAINT "ProductionReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionReceipt" ADD CONSTRAINT "ProductionReceipt_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrap" ADD CONSTRAINT "Scrap_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrap" ADD CONSTRAINT "Scrap_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrap" ADD CONSTRAINT "Scrap_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrap" ADD CONSTRAINT "Scrap_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
