import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { inviteUserDto } from '@eserp/shared';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @Permissions('users:read')
  list(@CurrentTenantId() t: string, @Query('page') p = '1', @Query('pageSize') ps = '20') {
    return this.users.list(t, Number(p) || 1, Number(ps) || 20);
  }

  @Post('invite')
  @Permissions('users:invite')
  invite(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.users.invite(t, u, inviteUserDto.parse(body));
  }

  @Patch(':id')
  @Permissions('users:manage')
  update(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: any) {
    return this.users.update(t, u, id, body);
  }
}
