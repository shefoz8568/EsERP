import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { csvImportDto, itemCategoryDto, itemCategoryUpdateDto, itemDto, itemUpdateDto } from '@eserp/shared';
import { ItemsService } from './items.service';
import { CsvImportService } from '../master-data/csv-import.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';

@ApiTags('items')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ItemsController {
  constructor(
    @Inject(ItemsService) private readonly items: ItemsService,
    @Inject(CsvImportService) private readonly csvImport: CsvImportService,
  ) {}

  // --- Item categories ---
  @Get('item-categories')
  @Permissions('items:read')
  listCategories(@CurrentTenantId() t: string) {
    return this.items.listCategories(t);
  }

  @Get('item-categories/:id')
  @Permissions('items:read')
  getCategory(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.items.getCategory(t, id);
  }

  @Post('item-categories')
  @Permissions('items:manage')
  createCategory(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.items.createCategory(t, u, itemCategoryDto.parse(body));
  }

  @Patch('item-categories/:id')
  @Permissions('items:manage')
  updateCategory(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.items.updateCategory(t, u, id, itemCategoryUpdateDto.parse(body));
  }

  @Delete('item-categories/:id')
  @Permissions('items:manage')
  deleteCategory(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.items.deleteCategory(t, u, id);
  }

  // --- Items ---
  @Get('items')
  @Permissions('items:read')
  listItems(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('categoryId') categoryId?: string,
    @Query('status') status?: string, @Query('costingMethod') costingMethod?: string,
  ) {
    return this.items.listItems(t, { page, pageSize, search, categoryId, status, costingMethod });
  }

  @Get('items/:id')
  @Permissions('items:read')
  getItem(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.items.getItem(t, id);
  }

  @Post('items')
  @Permissions('items:manage')
  createItem(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.items.createItem(t, u, itemDto.parse(body));
  }

  @Patch('items/:id')
  @Permissions('items:manage')
  updateItem(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.items.updateItem(t, u, id, itemUpdateDto.parse(body));
  }

  @Delete('items/:id')
  @Permissions('items:manage')
  deleteItem(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.items.deleteItem(t, u, id);
  }

  /** CSV import preview: validated rows + per-row errors, nothing persisted. */
  @Post('items/import/preview')
  @Permissions('items:manage')
  importPreview(@Body() body: unknown) {
    const { csvText } = csvImportDto.parse(body);
    return this.csvImport.previewItems(csvText);
  }
}
