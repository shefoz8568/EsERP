import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { contactDto, contactUpdateDto, csvImportDto } from '@eserp/shared';
import { ContactsService } from './contacts.service';
import { CsvImportService } from '../master-data/csv-import.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';

@ApiTags('contacts')
@Controller('contacts')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ContactsController {
  constructor(
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(CsvImportService) private readonly csvImport: CsvImportService,
  ) {}

  @Get()
  @Permissions('contacts:read')
  list(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('type') type?: string, @Query('status') status?: string,
  ) {
    return this.contacts.list(t, { page, pageSize, search, type, status });
  }

  @Get(':id')
  @Permissions('contacts:read')
  get(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.contacts.get(t, id);
  }

  @Post()
  @Permissions('contacts:manage')
  create(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.contacts.create(t, u, contactDto.parse(body));
  }

  @Patch(':id')
  @Permissions('contacts:manage')
  update(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.contacts.update(t, u, id, contactUpdateDto.parse(body));
  }

  @Delete(':id')
  @Permissions('contacts:manage')
  delete(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.contacts.delete(t, u, id);
  }

  /** CSV import preview: validated rows + per-row errors, nothing persisted. */
  @Post('import/preview')
  @Permissions('contacts:manage')
  importPreview(@Body() body: unknown) {
    const { csvText } = csvImportDto.parse(body);
    return this.csvImport.previewContacts(csvText);
  }
}
