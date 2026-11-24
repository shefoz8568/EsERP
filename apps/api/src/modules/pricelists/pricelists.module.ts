import { Module } from '@nestjs/common';
import { PriceListsService } from './pricelists.service';
import { PriceListsController } from './pricelists.controller';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';

@Module({ imports: [AuditModule, QueueModule], providers: [PriceListsService], controllers: [PriceListsController], exports: [PriceListsService] })
export class PriceListsModule {}
