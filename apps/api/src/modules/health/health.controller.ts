import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async check() {
    const db = await this.prisma.healthCheck();
    return { status: db ? 'ok' : 'degraded', db: db ? 'up' : 'down', timestamp: new Date().toISOString() };
  }
}
