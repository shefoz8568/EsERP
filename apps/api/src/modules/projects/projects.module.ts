import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { TimesheetsService } from './timesheets.service';
import { ExpensesService } from './expenses.service';
import { MilestonesService } from './milestones.service';
import { CostingService } from './costing.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { SalesModule } from '../sales/sales.module';

@Module({
  imports: [AuditModule, QueueModule, SalesModule],
  providers: [ProjectsService, TasksService, TimesheetsService, ExpensesService, MilestonesService, CostingService],
  controllers: [ProjectsController],
  exports: [ProjectsService, TasksService, TimesheetsService, ExpensesService, MilestonesService, CostingService],
})
export class ProjectsModule {}
