import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { CsvImportService } from '../master-data/csv-import.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';

@Module({ imports: [AuditModule, QueueModule], providers: [ContactsService, CsvImportService], controllers: [ContactsController], exports: [ContactsService] })
export class ContactsModule {}
