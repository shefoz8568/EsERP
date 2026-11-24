import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { PurchasingReportsService } from './reports.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AuditModule, QueueModule, SettingsModule, AccountingModule],
  providers: [PurchaseOrdersService, SupplierInvoicesService, SupplierPaymentsService, PurchasingReportsService],
  controllers: [PurchasingController],
  exports: [PurchaseOrdersService, SupplierInvoicesService, SupplierPaymentsService, PurchasingReportsService],
})
export class PurchasingModule {}
