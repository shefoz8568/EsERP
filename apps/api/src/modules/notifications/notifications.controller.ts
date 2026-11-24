import { Controller, Get, Inject, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @Permissions('notifications:read')
  list(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Query('page') p = '1', @Query('pageSize') ps = '20', @Query('unreadOnly') unread?: string) {
    return this.notifications.list(t, u, Number(p) || 1, Number(ps) || 20, unread === 'true');
  }

  @Patch(':id/read')
  @Permissions('notifications:read')
  markRead(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.notifications.markRead(t, u, id);
  }
}
