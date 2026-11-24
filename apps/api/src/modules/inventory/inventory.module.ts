import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { StockService } from './stock.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { DeliveryNotesService } from './delivery-notes.service';
import { AdjustmentsService } from './adjustments.service';
import { TransfersService } from './transfers.service';
import { CountsService } from './counts.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AuditModule, QueueModule, SettingsModule, AccountingModule],
  providers: [
    StockService,
    GoodsReceiptsService,
    DeliveryNotesService,
    AdjustmentsService,
    TransfersService,
    CountsService,
  ],
  controllers: [InventoryController],
  exports: [StockService, GoodsReceiptsService, DeliveryNotesService, AdjustmentsService, TransfersService, CountsService],
})
export class InventoryModule {}
