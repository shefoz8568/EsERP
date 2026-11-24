import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  bomDto,
  bomUpdateDto,
  materialIssueDto,
  productionReceiptDto,
  scrapDto,
  workCenterDto,
  workCenterUpdateDto,
  workOrderDto,
  workOrderOperationUpdateDto,
  workOrderUpdateDto,
} from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { WorkCentersService } from './work-centers.service';
import { BomsService } from './boms.service';
import { WorkOrdersService } from './work-orders.service';
import { ProductionService } from './production.service';

@ApiTags('manufacturing')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ManufacturingController {
  constructor(
    @Inject(WorkCentersService) private readonly workCenters: WorkCentersService,
    @Inject(BomsService) private readonly boms: BomsService,
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(ProductionService) private readonly production: ProductionService,
  ) {}

  // --- Work centres ---
  @Get('manufacturing/work-centers')
  @Permissions('work-centers:read')
  listWorkCenters(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
  ) {
    return this.workCenters.list(t, { page, pageSize, search, status });
  }

  @Get('manufacturing/work-centers/:id')
  @Permissions('work-centers:read')
  getWorkCenter(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.workCenters.get(t, id);
  }

  @Post('manufacturing/work-centers')
  @Permissions('work-centers:manage')
  createWorkCenter(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.workCenters.create(t, u, workCenterDto.parse(body));
  }

  @Patch('manufacturing/work-centers/:id')
  @Permissions('work-centers:manage')
  updateWorkCenter(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.workCenters.update(t, u, id, workCenterUpdateDto.parse(body));
  }

  @Delete('manufacturing/work-centers/:id')
  @Permissions('work-centers:manage')
  deleteWorkCenter(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.workCenters.delete(t, u, id);
  }

  // --- BOMs ---
  @Get('manufacturing/boms')
  @Permissions('boms:read')
  listBoms(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('finishedItemId') finishedItemId?: string,
  ) {
    return this.boms.list(t, { page, pageSize, search, status, finishedItemId });
  }

  @Get('manufacturing/boms/:id')
  @Permissions('boms:read')
  getBom(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.boms.get(t, id);
  }

  @Get('manufacturing/boms/:id/cost')
  @Permissions('boms:read')
  getBomCost(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.boms.cost(t, id);
  }

  @Post('manufacturing/boms')
  @Permissions('boms:manage')
  createBom(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.boms.create(t, u, bomDto.parse(body));
  }

  @Patch('manufacturing/boms/:id')
  @Permissions('boms:manage')
  updateBom(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.boms.update(t, u, id, bomUpdateDto.parse(body));
  }

  @Delete('manufacturing/boms/:id')
  @Permissions('boms:manage')
  deleteBom(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.boms.delete(t, u, id);
  }

  // --- Work orders ---
  @Get('manufacturing/work-orders')
  @Permissions('work-orders:read')
  listWorkOrders(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('finishedItemId') finishedItemId?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.workOrders.list(t, { page, pageSize, search, status, finishedItemId, warehouseId });
  }

  @Get('manufacturing/work-orders/:id')
  @Permissions('work-orders:read')
  getWorkOrder(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.workOrders.get(t, id);
  }

  @Post('manufacturing/work-orders')
  @Permissions('work-orders:manage')
  createWorkOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.workOrders.create(t, u, workOrderDto.parse(body));
  }

  @Patch('manufacturing/work-orders/:id')
  @Permissions('work-orders:manage')
  updateWorkOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.workOrders.update(t, u, id, workOrderUpdateDto.parse(body));
  }

  @Post('manufacturing/work-orders/:id/release')
  @Permissions('work-orders:manage')
  releaseWorkOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.workOrders.release(t, u, id);
  }

  @Post('manufacturing/work-orders/:id/complete')
  @Permissions('work-orders:manage')
  completeWorkOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.workOrders.complete(t, u, id);
  }

  @Post('manufacturing/work-orders/:id/cancel')
  @Permissions('work-orders:manage')
  cancelWorkOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.workOrders.cancel(t, u, id);
  }

  @Delete('manufacturing/work-orders/:id')
  @Permissions('work-orders:manage')
  deleteWorkOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.workOrders.delete(t, u, id);
  }

  @Patch('manufacturing/work-orders/:workOrderId/operations/:operationId')
  @Permissions('work-orders:manage')
  updateOperation(
    @CurrentTenantId() t: string, @CurrentUserId() u: string,
    @Param('workOrderId') workOrderId: string, @Param('operationId') operationId: string, @Body() body: unknown,
  ) {
    const dto = workOrderOperationUpdateDto.parse(body);
    return this.workOrders.updateOperation(t, u, workOrderId, operationId, dto.actualHours, dto.status);
  }

  // --- Material issues ---
  @Get('manufacturing/material-issues')
  @Permissions('work-orders:read')
  listIssues(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.production.listIssues(t, { page, pageSize, search, status, workOrderId, warehouseId });
  }

  @Get('manufacturing/material-issues/:id')
  @Permissions('work-orders:read')
  getIssue(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.production.getIssue(t, id);
  }

  @Post('manufacturing/material-issues')
  @Permissions('work-orders:manage')
  createIssue(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.production.createIssue(t, u, materialIssueDto.parse(body));
  }

  @Post('manufacturing/material-issues/:id/post')
  @Permissions('work-orders:manage')
  postIssue(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.postIssue(t, u, id);
  }

  @Post('manufacturing/material-issues/:id/cancel')
  @Permissions('work-orders:manage')
  cancelIssue(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.cancelIssue(t, u, id);
  }

  @Delete('manufacturing/material-issues/:id')
  @Permissions('work-orders:manage')
  deleteIssue(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.deleteIssue(t, u, id);
  }

  // --- Production receipts ---
  @Get('manufacturing/production-receipts')
  @Permissions('work-orders:read')
  listReceipts(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.production.listReceipts(t, { page, pageSize, search, status, workOrderId, warehouseId });
  }

  @Get('manufacturing/production-receipts/:id')
  @Permissions('work-orders:read')
  getReceipt(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.production.getReceipt(t, id);
  }

  @Post('manufacturing/production-receipts')
  @Permissions('work-orders:manage')
  createReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.production.createReceipt(t, u, productionReceiptDto.parse(body));
  }

  @Post('manufacturing/production-receipts/:id/post')
  @Permissions('work-orders:manage')
  postReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.postReceipt(t, u, id);
  }

  @Post('manufacturing/production-receipts/:id/cancel')
  @Permissions('work-orders:manage')
  cancelReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.cancelReceipt(t, u, id);
  }

  @Delete('manufacturing/production-receipts/:id')
  @Permissions('work-orders:manage')
  deleteReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.deleteReceipt(t, u, id);
  }

  // --- Scrap ---
  @Get('manufacturing/scrap')
  @Permissions('work-orders:read')
  listScrap(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.production.listScrap(t, { page, pageSize, search, status, workOrderId, warehouseId });
  }

  @Get('manufacturing/scrap/:id')
  @Permissions('work-orders:read')
  getScrap(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.production.getScrap(t, id);
  }

  @Post('manufacturing/scrap')
  @Permissions('work-orders:manage')
  createScrap(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.production.createScrap(t, u, scrapDto.parse(body));
  }

  @Post('manufacturing/scrap/:id/post')
  @Permissions('work-orders:manage')
  postScrap(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.postScrap(t, u, id);
  }

  @Post('manufacturing/scrap/:id/cancel')
  @Permissions('work-orders:manage')
  cancelScrap(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.cancelScrap(t, u, id);
  }

  @Delete('manufacturing/scrap/:id')
  @Permissions('work-orders:manage')
  deleteScrap(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.production.deleteScrap(t, u, id);
  }

  // --- WIP report ---
  @Get('manufacturing/reports/wip')
  @Permissions('manufacturing:read')
  wipReport(@CurrentTenantId() t: string, @Query('warehouseId') warehouseId?: string) {
    return this.production.wipReport(t, warehouseId);
  }
}
