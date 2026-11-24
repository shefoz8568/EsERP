import { Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { posSaleDto, posShiftCloseDto, posShiftDto, posTerminalDto, posTerminalUpdateDto } from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { PosTerminalsService } from './terminals.service';
import { PosShiftsService } from './shifts.service';
import { PosSalesService } from './sales.service';

@ApiTags('pos')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class PosController {
  constructor(
    @Inject(PosTerminalsService) private readonly terminals: PosTerminalsService,
    @Inject(PosShiftsService) private readonly shifts: PosShiftsService,
    @Inject(PosSalesService) private readonly sales: PosSalesService,
  ) {}

  // --- Terminals ---
  @Get('pos/terminals')
  @Permissions('pos-terminals:read')
  listTerminals(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('branchId') branchId?: string,
  ) {
    return this.terminals.list(t, { page, pageSize, search, status, branchId });
  }

  @Get('pos/terminals/:id')
  @Permissions('pos-terminals:read')
  getTerminal(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.terminals.get(t, id);
  }

  @Post('pos/terminals')
  @Permissions('pos-terminals:manage')
  createTerminal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.terminals.create(t, u, posTerminalDto.parse(body));
  }

  @Post('pos/terminals/:id')
  @Permissions('pos-terminals:manage')
  updateTerminal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.terminals.update(t, u, id, posTerminalUpdateDto.parse(body));
  }

  @Delete('pos/terminals/:id')
  @Permissions('pos-terminals:manage')
  deleteTerminal(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.terminals.delete(t, u, id);
  }

  // --- Shifts ---
  @Get('pos/shifts')
  @Permissions('pos-shifts:read')
  listShifts(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('terminalId') terminalId?: string, @Query('status') status?: string, @Query('cashierId') cashierId?: string,
  ) {
    return this.shifts.list(t, { page, pageSize, terminalId, status, cashierId });
  }

  @Get('pos/shifts/:id')
  @Permissions('pos-shifts:read')
  getShift(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.shifts.get(t, id);
  }

  @Get('pos/shifts/:id/z-report')
  @Permissions('pos-shifts:read')
  zReport(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.shifts.zReport(t, id);
  }

  @Post('pos/shifts/open')
  @Permissions('pos-shifts:manage')
  openShift(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.shifts.open(t, u, posShiftDto.parse(body));
  }

  @Post('pos/shifts/:id/close')
  @Permissions('pos-shifts:manage')
  closeShift(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.shifts.close(t, u, id, posShiftCloseDto.parse(body));
  }

  // --- Sales ---
  @Get('pos/sales')
  @Permissions('pos-sales:read')
  listSales(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('terminalId') terminalId?: string, @Query('shiftId') shiftId?: string,
  ) {
    return this.sales.list(t, { page, pageSize, search, status, terminalId, shiftId });
  }

  @Get('pos/sales/:id')
  @Permissions('pos-sales:read')
  getSale(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.sales.get(t, id);
  }

  @Get('pos/lookup')
  @Permissions('pos-sales:read')
  lookup(@CurrentTenantId() t: string, @Query('terminalId') terminalId: string, @Query('q') q: string) {
    return this.sales.lookup(t, terminalId, q);
  }

  @Post('pos/sales')
  @Permissions('pos-sales:manage')
  createSale(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.sales.create(t, u, posSaleDto.parse(body));
  }

  @Post('pos/sales/:id/void')
  @Permissions('pos-sales:manage')
  voidSale(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.sales.void(t, u, id);
  }
}
