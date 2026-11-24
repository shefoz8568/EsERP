import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';

@Module({ imports: [AuditModule, QueueModule], providers: [OnboardingService], controllers: [OnboardingController] })
export class OnboardingModule {}
