import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';

@Module({ imports: [AuditModule, QueueModule], providers: [UsersService], controllers: [UsersController] })
export class UsersModule {}
