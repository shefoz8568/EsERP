import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { webhookEndpointDto, webhookEndpointUpdateDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly webhooks: WebhooksService) {}

  @Get('webhooks/endpoints')
  @Permissions('webhooks:read')
  listEndpoints(@CurrentTenantId() t: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.webhooks.listEndpoints(t, { page, pageSize, status });
  }

  @Post('webhooks/endpoints')
  @Permissions('webhooks:manage')
  createEndpoint(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.webhooks.createEndpoint(t, u, webhookEndpointDto.parse(body));
  }

  @Patch('webhooks/endpoints/:id')
  @Permissions('webhooks:manage')
  updateEndpoint(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.webhooks.updateEndpoint(t, u, id, webhookEndpointUpdateDto.parse(body));
  }

  @Delete('webhooks/endpoints/:id')
  @Permissions('webhooks:manage')
  deleteEndpoint(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.webhooks.deleteEndpoint(t, u, id);
  }

  @Post('webhooks/endpoints/:id/test')
  @Permissions('webhooks:manage')
  testEndpoint(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.webhooks.testEndpoint(t, u, id);
  }

  @Get('webhooks/deliveries')
  @Permissions('webhooks:read')
  listDeliveries(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('endpointId') endpointId?: string, @Query('status') status?: string, @Query('eventType') eventType?: string,
  ) {
    return this.webhooks.listDeliveries(t, { page, pageSize, endpointId, status, eventType });
  }
}
