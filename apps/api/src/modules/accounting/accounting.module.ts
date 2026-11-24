import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { JournalsService } from './journals.service';
import { PeriodsService } from './periods.service';
import { CostCentersService } from './cost-centers.service';
import { ReportsService } from './reports.service';
import { PostingService } from './posting.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AuditModule, QueueModule, SettingsModule],
  providers: [JournalsService, PeriodsService, CostCentersService, ReportsService, PostingService],
  controllers: [AccountingController],
  exports: [JournalsService, PeriodsService, CostCentersService, ReportsService, PostingService],
})
export class AccountingModule {}
