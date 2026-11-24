import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosTerminalsService } from './terminals.service';
import { PosShiftsService } from './shifts.service';
import { PosSalesService } from './sales.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [AuditModule, QueueModule, SettingsModule, AccountingModule, InventoryModule],
  providers: [PosTerminalsService, PosShiftsService, PosSalesService],
  controllers: [PosController],
  exports: [PosTerminalsService, PosShiftsService, PosSalesService],
})
export class PosModule {}
