import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { zatcaGenerateDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { ZatcaService } from './zatca.service';

@ApiTags('zatca')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ZatcaController {
  constructor(@Inject(ZatcaService) private readonly zatca: ZatcaService) {}

  @Get('zatca/documents')
  @Permissions('zatca:read')
  list(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('status') status?: string, @Query('type') type?: string, @Query('invoiceId') invoiceId?: string,
  ) {
    return this.zatca.list(t, { page, pageSize, status, type, invoiceId });
  }

  @Get('zatca/documents/:id')
  @Permissions('zatca:read')
  get(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.zatca.get(t, id);
  }

  @Post('zatca/documents')
  @Permissions('zatca:manage')
  generate(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    const dto = zatcaGenerateDto.parse(body);
    return this.zatca.generate(t, u, dto.invoiceId, dto.type);
  }

  @Post('zatca/documents/:id/submit')
  @Permissions('zatca:manage')
  submit(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.zatca.submit(t, u, id);
  }
}
