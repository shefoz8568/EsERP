import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ExportsService } from './exports.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [ConfigModule, AuditModule, QueueModule],
  providers: [AnalyticsService, ExportsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService, ExportsService],
})
export class AnalyticsModule {}
