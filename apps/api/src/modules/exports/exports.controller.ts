import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { exportJobDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  private canReadSensitive(req: { permissions?: string[] }): boolean {
    const perms = req.permissions ?? [];
    return perms.includes('*') || perms.includes('hr:read-sensitive');
  }

  @Get('exports/jobs')
  @Permissions('exports:read')
  listJobs(@CurrentTenantId() t: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('type') type?: string, @Query('status') status?: string) {
    return this.exports.listJobs(t, { page, pageSize, type, status });
  }

  @Get('exports/jobs/:id')
  @Permissions('exports:read')
  getJob(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.exports.getJob(t, id);
  }

  @Post('exports/jobs')
  @Permissions('exports:manage')
  createJob(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Req() req: { permissions?: string[] }, @Body() body: unknown) {
    const dto = exportJobDto.parse(body);
    return this.exports.createJob(t, u, dto.type, dto.format, this.canReadSensitive(req));
  }

  @Get('exports/:type')
  @Permissions('exports:read')
  async download(
    @CurrentTenantId() t: string,
    @Req() req: { permissions?: string[] },
    @Res() res: Response,
    @Param('type') type: string,
    @Query('format') format?: string,
  ) {
    const result = await this.exports.download(t, type, (format ?? 'csv').toUpperCase(), this.canReadSensitive(req));
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  }
}
