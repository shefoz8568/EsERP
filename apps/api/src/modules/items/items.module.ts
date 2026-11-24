import { Module } from '@nestjs/common';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';
import { CsvImportService } from '../master-data/csv-import.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';

@Module({ imports: [AuditModule, QueueModule], providers: [ItemsService, CsvImportService], controllers: [ItemsController], exports: [ItemsService] })
export class ItemsModule {}
