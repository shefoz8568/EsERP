import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { mockPaymentChargeDto, mockSmsDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { ProvidersService } from './providers.service';

@ApiTags('providers')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ProvidersController {
  constructor(@Inject(ProvidersService) private readonly providers: ProvidersService) {}

  @Get('providers/status')
  @Permissions('settings:read')
  status() {
    return this.providers.status();
  }

  @Post('providers/payments/simulate-charge')
  @Permissions('settings:manage')
  simulateCharge(@Body() body: unknown) {
    return this.providers.charge(mockPaymentChargeDto.parse(body));
  }

  @Post('providers/payments/simulate-refund')
  @Permissions('settings:manage')
  simulateRefund(@Body() body: unknown) {
    const dto = mockPaymentChargeDto.parse(body);
    return this.providers.refund(dto.reference ?? 'mock_txn_unknown', dto.amountMinor);
  }

  @Post('providers/sms/simulate-send')
  @Permissions('settings:manage')
  simulateSms(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.providers.sendSms(t, u, mockSmsDto.parse(body));
  }
}
