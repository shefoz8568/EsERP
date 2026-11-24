import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ZatcaController } from './zatca.controller';
import { ZatcaService } from './zatca.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [ConfigModule, AuditModule, QueueModule],
  providers: [ZatcaService],
  controllers: [ZatcaController],
  exports: [ZatcaService],
})
export class ZatcaModule {}
