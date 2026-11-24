import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  costCenterDto,
  costCenterUpdateDto,
  fiscalPeriodDto,
  fiscalPeriodUpdateDto,
  journalEntryDto,
  journalEntryUpdateDto,
  openingBalanceDto,
  openingBalanceUpdateDto,
} from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { JournalsService } from './journals.service';
import { PeriodsService } from './periods.service';
import { CostCentersService } from './cost-centers.service';
import { ReportsService } from './reports.service';

@ApiTags('accounting')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AccountingController {
  constructor(
    @Inject(JournalsService) private readonly journals: JournalsService,
    @Inject(PeriodsService) private readonly periods: PeriodsService,
    @Inject(CostCentersService) private readonly costCenters: CostCentersService,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  // --- Journal entries ---
  @Get('journals')
  @Permissions('journals:read')
  listJournals(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string, @Query('sourceModule') sourceModule?: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.journals.list(t, { page, pageSize, search, status, fiscalPeriodId, sourceModule, from, to });
  }

  @Get('journals/:id')
  @Permissions('journals:read')
  getJournal(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.journals.get(t, id);
  }

  @Post('journals')
  @Permissions('journals:manage')
  createJournal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.journals.createDraft(t, u, journalEntryDto.parse(body));
  }

  @Patch('journals/:id')
  @Permissions('journals:manage')
  updateJournal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.journals.updateDraft(t, u, id, journalEntryUpdateDto.parse(body));
  }

  @Delete('journals/:id')
  @Permissions('journals:manage')
  deleteJournal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.journals.deleteDraft(t, u, id);
  }

  @Post('journals/:id/post')
  @Permissions('journals:manage')
  postJournal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.journals.post(t, u, id);
  }

  @Post('journals/:id/reverse')
  @Permissions('journals:manage')
  reverseJournal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.journals.reverse(t, u, id);
  }

  // --- Fiscal periods ---
  @Get('fiscal-periods')
  @Permissions('periods:read')
  listPeriods(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('fiscalYear') fiscalYear?: string, @Query('status') status?: string,
  ) {
    return this.periods.list(t, { page, pageSize, fiscalYear, status });
  }

  @Get('fiscal-periods/:id')
  @Permissions('periods:read')
  getPeriod(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.periods.get(t, id);
  }

  @Post('fiscal-periods')
  @Permissions('periods:manage')
  createPeriod(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.periods.create(t, u, fiscalPeriodDto.parse(body));
  }

  @Patch('fiscal-periods/:id')
  @Permissions('periods:manage')
  updatePeriod(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.periods.updateStatus(t, u, id, fiscalPeriodUpdateDto.parse(body).status);
  }

  @Delete('fiscal-periods/:id')
  @Permissions('periods:manage')
  deletePeriod(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.periods.delete(t, u, id);
  }

  // --- Cost centres ---
  @Get('cost-centers')
  @Permissions('cost-centers:read')
  listCostCenters(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
  ) {
    return this.costCenters.list(t, { page, pageSize, search, status });
  }

  @Get('cost-centers/:id')
  @Permissions('cost-centers:read')
  getCostCenter(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.costCenters.get(t, id);
  }

  @Post('cost-centers')
  @Permissions('cost-centers:manage')
  createCostCenter(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.costCenters.create(t, u, costCenterDto.parse(body));
  }

  @Patch('cost-centers/:id')
  @Permissions('cost-centers:manage')
  updateCostCenter(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.costCenters.update(t, u, id, costCenterUpdateDto.parse(body));
  }

  @Delete('cost-centers/:id')
  @Permissions('cost-centers:manage')
  deleteCostCenter(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.costCenters.delete(t, u, id);
  }

  // --- Opening balances ---
  @Get('opening-balances')
  @Permissions('accounting:read')
  listOpeningBalances(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    return this.reports.listOpeningBalances(t, { page, pageSize, fiscalYear });
  }

  @Post('opening-balances')
  @Permissions('accounting:manage')
  upsertOpeningBalance(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.reports.upsertOpeningBalance(t, u, openingBalanceDto.parse(body));
  }

  @Patch('opening-balances/:id')
  @Permissions('accounting:manage')
  updateOpeningBalance(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.reports.updateOpeningBalance(t, u, id, openingBalanceUpdateDto.parse(body));
  }

  @Delete('opening-balances/:id')
  @Permissions('accounting:manage')
  deleteOpeningBalance(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.reports.deleteOpeningBalance(t, u, id);
  }

  // --- Reports (read-only) ---
  @Get('reports/trial-balance')
  @Permissions('accounting:read')
  trialBalance(@CurrentTenantId() t: string, @Query('fiscalPeriodId') fiscalPeriodId: string) {
    return this.reports.trialBalance(t, fiscalPeriodId);
  }

  @Get('reports/general-ledger')
  @Permissions('accounting:read')
  generalLedger(
    @CurrentTenantId() t: string,
    @Query('accountId') accountId: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.reports.generalLedger(t, accountId, from, to);
  }

  @Get('reports/vat-summary')
  @Permissions('accounting:read')
  vatSummary(@CurrentTenantId() t: string, @Query('fiscalPeriodId') fiscalPeriodId: string) {
    return this.reports.vatSummary(t, fiscalPeriodId);
  }
}
