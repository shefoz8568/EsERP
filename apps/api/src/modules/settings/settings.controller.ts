import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { companyProfileDto, currencyDto, taxRateDto, uomDto, uomConversionDto, numberingSeriesDto, warehouseDto, branchDto } from '@eserp/shared';

@ApiTags('settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get('company')
  @Permissions('settings:read')
  getCompany(@CurrentTenantId() t: string) { return this.settings.getCompany(t); }

  @Patch('company')
  @Permissions('settings:manage')
  updateCompany(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.updateCompany(t, u, companyProfileDto.parse(body));
  }

  @Get('chart-of-accounts')
  @Permissions('accounting:read')
  listChartOfAccounts(@CurrentTenantId() t: string) { return this.settings.listChartOfAccounts(t); }

  @Get('currencies')
  @Permissions('settings:read')
  listCurrencies(@CurrentTenantId() t: string) { return this.settings.listCurrencies(t); }

  @Post('currencies')
  @Permissions('settings:manage')
  createCurrency(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.createCurrency(t, u, currencyDto.parse(body));
  }

  @Delete('currencies/:id')
  @Permissions('settings:manage')
  deleteCurrency(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.settings.deleteCurrency(t, u, id);
  }

  @Get('taxes')
  @Permissions('settings:read')
  listTaxes(@CurrentTenantId() t: string) { return this.settings.listTaxes(t); }

  @Post('taxes')
  @Permissions('settings:manage')
  createTax(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.createTax(t, u, taxRateDto.parse(body));
  }

  @Patch('taxes/:id')
  @Permissions('settings:manage')
  updateTax(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: any) {
    return this.settings.updateTax(t, u, id, body);
  }

  @Delete('taxes/:id')
  @Permissions('settings:manage')
  deleteTax(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.settings.deleteTax(t, u, id);
  }

  @Get('units')
  @Permissions('settings:read')
  listUnits(@CurrentTenantId() t: string) { return this.settings.listUnits(t); }

  @Post('units')
  @Permissions('settings:manage')
  createUnit(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.createUnit(t, u, uomDto.parse(body));
  }

  @Post('units/conversions')
  @Permissions('settings:manage')
  createConversion(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.createConversion(t, u, uomConversionDto.parse(body));
  }

  @Get('numbering-series')
  @Permissions('settings:read')
  listSeries(@CurrentTenantId() t: string) { return this.settings.listSeries(t); }

  @Post('numbering-series')
  @Permissions('settings:manage')
  createSeries(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.createSeries(t, u, numberingSeriesDto.parse(body));
  }

  @Patch('numbering-series/:id')
  @Permissions('settings:manage')
  updateSeries(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: any) {
    return this.settings.updateSeries(t, u, id, body);
  }

  @Get('warehouses')
  @Permissions('warehouses:read')
  listWarehouses(@CurrentTenantId() t: string) { return this.settings.listWarehouses(t); }

  @Post('warehouses')
  @Permissions('warehouses:manage')
  createWarehouse(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.createWarehouse(t, u, warehouseDto.parse(body));
  }

  @Patch('warehouses/:id')
  @Permissions('warehouses:manage')
  updateWarehouse(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: any) {
    return this.settings.updateWarehouse(t, u, id, body);
  }

  @Delete('warehouses/:id')
  @Permissions('warehouses:manage')
  deleteWarehouse(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.settings.deleteWarehouse(t, u, id);
  }

  @Get('branches')
  @Permissions('settings:read')
  listBranches(@CurrentTenantId() t: string) { return this.settings.listBranches(t); }

  @Post('branches')
  @Permissions('settings:manage')
  createBranch(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.settings.createBranch(t, u, branchDto.parse(body));
  }

  @Patch('branches/:id')
  @Permissions('settings:manage')
  updateBranch(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: any) {
    return this.settings.updateBranch(t, u, id, body);
  }
}
