import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { NumberingSeriesService } from './numbering.service';
import { AuditModule } from '../audit/audit.module';

@Module({ imports: [AuditModule], providers: [SettingsService, NumberingSeriesService], controllers: [SettingsController], exports: [SettingsService, NumberingSeriesService] })
export class SettingsModule {}
