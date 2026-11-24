import { Module } from '@nestjs/common';
import { ManufacturingController } from './manufacturing.controller';
import { WorkCentersService } from './work-centers.service';
import { BomsService } from './boms.service';
import { WorkOrdersService } from './work-orders.service';
import { ProductionService } from './production.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [AuditModule, QueueModule, SettingsModule, AccountingModule, InventoryModule],
  providers: [WorkCentersService, BomsService, WorkOrdersService, ProductionService],
  controllers: [ManufacturingController],
  exports: [WorkCentersService, BomsService, WorkOrdersService, ProductionService],
})
export class ManufacturingModule {}
