import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { onboardingStepDto } from '@eserp/shared';

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  @Get()
  @Permissions('onboarding:read')
  get(@CurrentTenantId() t: string) { return this.onboarding.get(t); }

  @Post('step')
  @Permissions('onboarding:manage')
  step(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    const dto = onboardingStepDto.parse(body);
    return this.onboarding.submitStep(t, u, dto.step, dto.data as Record<string, unknown>);
  }

  @Post('import/preview')
  @Permissions('onboarding:manage')
  preview(@Body() body: { csvText: string }) {
    return this.onboarding.previewCsv(body.csvText ?? '');
  }

  @Post('complete')
  @Permissions('onboarding:manage')
  complete(@CurrentTenantId() t: string, @CurrentUserId() u: string) {
    return this.onboarding.complete(t, u);
  }
}
