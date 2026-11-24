import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { roleDto } from '@eserp/shared';

@ApiTags('roles')
@Controller('roles')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @Get()
  @Permissions('roles:read')
  list(@CurrentTenantId() t: string) { return this.roles.list(t); }

  @Get('permissions')
  @Permissions('roles:read')
  listPermissions() { return this.roles.listPermissions(); }

  @Post()
  @Permissions('roles:manage')
  create(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.roles.create(t, u, roleDto.parse(body));
  }

  @Patch(':id/permissions')
  @Permissions('roles:manage')
  setPermissions(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: { permissions: string[] }) {
    return this.roles.setPermissions(t, u, id, body.permissions ?? []);
  }
}
