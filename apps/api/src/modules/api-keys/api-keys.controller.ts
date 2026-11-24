import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiKeyDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { ApiKeysService } from './api-keys.service';

@ApiTags('api-keys')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly keys: ApiKeysService) {}

  @Get('api-keys')
  @Permissions('api-keys:read')
  list(@CurrentTenantId() t: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.keys.list(t, { page, pageSize, status });
  }

  @Get('api-keys/:id')
  @Permissions('api-keys:read')
  get(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.keys.get(t, id);
  }

  @Post('api-keys')
  @Permissions('api-keys:manage')
  create(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.keys.create(t, u, apiKeyDto.parse(body));
  }

  @Post('api-keys/:id/revoke')
  @Permissions('api-keys:manage')
  revoke(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.keys.revoke(t, u, id);
  }
}
