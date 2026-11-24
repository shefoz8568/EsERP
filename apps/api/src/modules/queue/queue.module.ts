import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QueueService } from './queue.service';
import { OutboxService } from './outbox.service';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({ imports: [ConfigModule, MailModule, PrismaModule], providers: [QueueService, OutboxService], exports: [QueueService, OutboxService] })
export class QueueModule {}
