import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { LeadsService } from './leads.service';
import { OpportunitiesService } from './opportunities.service';
import { QuotesService } from './quotes.service';
import { OrdersService } from './orders.service';
import { SalesInvoicesService } from './invoices.service';
import { CustomerPaymentsService } from './payments.service';
import { SalesReportsService } from './reports.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [AuditModule, QueueModule, SettingsModule, AccountingModule, InventoryModule],
  providers: [
    LeadsService, OpportunitiesService, QuotesService, OrdersService,
    SalesInvoicesService, CustomerPaymentsService, SalesReportsService,
  ],
  controllers: [SalesController],
  exports: [LeadsService, OpportunitiesService, QuotesService, OrdersService, SalesInvoicesService, CustomerPaymentsService, SalesReportsService],
})
export class SalesModule {}
