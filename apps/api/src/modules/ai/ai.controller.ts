import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { aiAskDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/tenant.decorator';
import { AiService } from './ai.service';

@ApiTags('ai')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Get('ai/insights')
  @Permissions('ai:read')
  insights(@CurrentTenantId() t: string) {
    return this.ai.insights(t);
  }

  @Post('ai/ask')
  @Permissions('ai:ask')
  ask(@CurrentTenantId() t: string, @Body() body: unknown) {
    const dto = aiAskDto.parse(body);
    return this.ai.ask(t, dto.question);
  }
}
