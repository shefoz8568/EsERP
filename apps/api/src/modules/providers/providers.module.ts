import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [ConfigModule, QueueModule],
  providers: [ProvidersService],
  controllers: [ProvidersController],
  exports: [ProvidersService],
})
export class ProvidersModule {}
