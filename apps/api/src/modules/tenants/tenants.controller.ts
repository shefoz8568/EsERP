import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';

@ApiTags('tenants')
@Controller('tenants/me')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class TenantsController {
  constructor(@Inject(TenantsService) private readonly tenants: TenantsService) {}

  @Get()
  @Permissions('tenants:read')
  get(@CurrentTenantId() tenantId: string) { return this.tenants.get(tenantId); }

  @Patch()
  @Permissions('tenants:manage')
  update(@CurrentTenantId() tenantId: string, @CurrentUserId() userId: string, @Body() body: any) {
    return this.tenants.update(tenantId, userId, body);
  }
}
