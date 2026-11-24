import { Body, Controller, Get, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { reportSnapshotDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { AnalyticsService } from './analytics.service';
import { ExportsService } from './exports.service';

@ApiTags('analytics')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(ExportsService) private readonly exports: ExportsService,
  ) {}

  @Get('analytics/dashboard')
  @Permissions('analytics:read')
  dashboard(
    @CurrentTenantId() t: string,
    @Query('year') year?: string, @Query('month') month?: string,
  ) {
    return this.analytics.dashboard(t, year ? Number(year) : undefined, month ? Number(month) : undefined);
  }

  @Get('analytics/profit-loss')
  @Permissions('analytics:read')
  profitLoss(
    @CurrentTenantId() t: string,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.analytics.profitLoss(t, { fiscalPeriodId, from, to });
  }

  @Get('analytics/balance-sheet')
  @Permissions('analytics:read')
  balanceSheet(@CurrentTenantId() t: string, @Query('asOf') asOf?: string) {
    return this.analytics.balanceSheet(t, asOf);
  }

  @Get('analytics/cash-flow')
  @Permissions('analytics:read')
  cashFlow(@CurrentTenantId() t: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.cashFlow(t, from, to);
  }

  @Get('analytics/exports/:report')
  @Permissions('reports:read')
  async exportCsv(
    @CurrentTenantId() t: string,
    @Param('report') report: string,
    @Res() res: Response,
    @Query('fiscalPeriodId') fiscalPeriodId?: string,
    @Query('from') from?: string, @Query('to') to?: string, @Query('asOf') asOf?: string,
  ) {
    const { filename, csv } = await this.exports.exportCsv(t, report, { fiscalPeriodId, from, to, asOf });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get('analytics/report-snapshots')
  @Permissions('reports:read')
  listSnapshots(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('type') type?: string,
  ) {
    return this.exports.listSnapshots(t, { page, pageSize, type });
  }

  @Get('analytics/report-snapshots/:id/download')
  @Permissions('reports:read')
  async downloadSnapshot(
    @CurrentTenantId() t: string, @Param('id') id: string,
    @Res() res: Response,
    @Query('format') format?: string,
  ) {
    const { filename, contentType, body } = await this.exports.downloadSnapshot(t, id, format);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  @Get('analytics/report-snapshots/:id')
  @Permissions('reports:read')
  getSnapshot(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.exports.getSnapshot(t, id);
  }

  @Post('analytics/report-snapshots')
  @Permissions('reports:manage')
  createSnapshot(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    const dto = reportSnapshotDto.parse(body);
    return this.exports.createSnapshot(t, u, dto);
  }
}
