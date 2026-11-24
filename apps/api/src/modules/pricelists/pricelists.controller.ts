import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { priceListDto, priceListItemDto, priceListUpdateDto } from '@eserp/shared';
import { PriceListsService } from './pricelists.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';

@ApiTags('pricelists')
@Controller('pricelists')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class PriceListsController {
  constructor(@Inject(PriceListsService) private readonly lists: PriceListsService) {}

  @Get()
  @Permissions('pricelists:read')
  list(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('currency') currency?: string, @Query('isDefault') isDefault?: string,
  ) {
    return this.lists.list(t, { page, pageSize, search, currency, isDefault });
  }

  @Get(':id')
  @Permissions('pricelists:read')
  get(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.lists.get(t, id);
  }

  @Post()
  @Permissions('pricelists:manage')
  create(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.lists.create(t, u, priceListDto.parse(body));
  }

  @Patch(':id')
  @Permissions('pricelists:manage')
  update(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.lists.update(t, u, id, priceListUpdateDto.parse(body));
  }

  @Delete(':id')
  @Permissions('pricelists:manage')
  delete(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.lists.delete(t, u, id);
  }

  @Post(':id/items')
  @Permissions('pricelists:manage')
  addItem(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.lists.addItem(t, u, id, priceListItemDto.parse(body));
  }

  @Delete(':id/items/:lineId')
  @Permissions('pricelists:manage')
  removeItem(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.lists.removeItem(t, u, id, lineId);
  }
}
