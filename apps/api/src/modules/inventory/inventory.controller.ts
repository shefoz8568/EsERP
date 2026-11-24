import { Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  deliveryNoteDto,
  goodsReceiptDto,
  stockAdjustmentDto,
  stockCountDto,
  stockTransferDto,
} from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { StockService } from './stock.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { DeliveryNotesService } from './delivery-notes.service';
import { AdjustmentsService } from './adjustments.service';
import { TransfersService } from './transfers.service';
import { CountsService } from './counts.service';

@ApiTags('inventory')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class InventoryController {
  constructor(
    @Inject(StockService) private readonly stock: StockService,
    @Inject(GoodsReceiptsService) private readonly receipts: GoodsReceiptsService,
    @Inject(DeliveryNotesService) private readonly deliveries: DeliveryNotesService,
    @Inject(AdjustmentsService) private readonly adjustments: AdjustmentsService,
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(CountsService) private readonly counts: CountsService,
  ) {}

  // --- Stock levels & movements ---
  @Get('inventory/stock')
  @Permissions('stock:read')
  listStock(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('warehouseId') warehouseId?: string, @Query('itemId') itemId?: string,
    @Query('search') search?: string, @Query('lowStockOnly') lowStockOnly?: string,
  ) {
    return this.stock.listLevels(t, { page, pageSize, warehouseId, itemId, search, lowStockOnly });
  }

  @Get('inventory/movements')
  @Permissions('stock:read')
  listMovements(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('warehouseId') warehouseId?: string, @Query('itemId') itemId?: string,
    @Query('type') type?: string, @Query('sourceType') sourceType?: string, @Query('sourceId') sourceId?: string,
  ) {
    return this.stock.listMovements(t, { page, pageSize, warehouseId, itemId, type, sourceType, sourceId });
  }

  @Get('inventory/reports/low-stock')
  @Permissions('stock:read')
  lowStock(@CurrentTenantId() t: string, @Query('warehouseId') warehouseId?: string) {
    return this.stock.lowStock(t, warehouseId);
  }

  // --- Goods receipts ---
  @Get('inventory/goods-receipts')
  @Permissions('goods-receipts:read')
  listReceipts(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.receipts.list(t, { page, pageSize, search, status, purchaseOrderId, warehouseId });
  }

  @Get('inventory/goods-receipts/:id')
  @Permissions('goods-receipts:read')
  getReceipt(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.receipts.get(t, id);
  }

  @Post('inventory/goods-receipts')
  @Permissions('goods-receipts:manage')
  createReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.receipts.create(t, u, goodsReceiptDto.parse(body));
  }

  @Post('inventory/goods-receipts/:id/post')
  @Permissions('goods-receipts:manage')
  postReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.receipts.post(t, u, id);
  }

  @Post('inventory/goods-receipts/:id/cancel')
  @Permissions('goods-receipts:manage')
  cancelReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.receipts.cancel(t, u, id);
  }

  @Delete('inventory/goods-receipts/:id')
  @Permissions('goods-receipts:manage')
  deleteReceipt(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.receipts.delete(t, u, id);
  }

  // --- Delivery notes ---
  @Get('inventory/delivery-notes')
  @Permissions('delivery-notes:read')
  listDeliveries(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('salesOrderId') salesOrderId?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.deliveries.list(t, { page, pageSize, search, status, salesOrderId, warehouseId });
  }

  @Get('inventory/delivery-notes/:id')
  @Permissions('delivery-notes:read')
  getDelivery(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.deliveries.get(t, id);
  }

  @Post('inventory/delivery-notes')
  @Permissions('delivery-notes:manage')
  createDelivery(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.deliveries.create(t, u, deliveryNoteDto.parse(body));
  }

  @Post('inventory/delivery-notes/:id/post')
  @Permissions('delivery-notes:manage')
  postDelivery(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.deliveries.post(t, u, id);
  }

  @Post('inventory/delivery-notes/:id/cancel')
  @Permissions('delivery-notes:manage')
  cancelDelivery(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.deliveries.cancel(t, u, id);
  }

  @Delete('inventory/delivery-notes/:id')
  @Permissions('delivery-notes:manage')
  deleteDelivery(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.deliveries.delete(t, u, id);
  }

  // --- Stock adjustments ---
  @Get('inventory/adjustments')
  @Permissions('adjustments:read')
  listAdjustments(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.adjustments.list(t, { page, pageSize, search, status, warehouseId });
  }

  @Get('inventory/adjustments/:id')
  @Permissions('adjustments:read')
  getAdjustment(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.adjustments.get(t, id);
  }

  @Post('inventory/adjustments')
  @Permissions('adjustments:manage')
  createAdjustment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.adjustments.create(t, u, stockAdjustmentDto.parse(body));
  }

  @Post('inventory/adjustments/:id/post')
  @Permissions('adjustments:manage')
  postAdjustment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.adjustments.post(t, u, id);
  }

  @Post('inventory/adjustments/:id/cancel')
  @Permissions('adjustments:manage')
  cancelAdjustment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.adjustments.cancel(t, u, id);
  }

  @Delete('inventory/adjustments/:id')
  @Permissions('adjustments:manage')
  deleteAdjustment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.adjustments.delete(t, u, id);
  }

  // --- Stock transfers ---
  @Get('inventory/transfers')
  @Permissions('transfers:read')
  listTransfers(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('fromWarehouseId') fromWarehouseId?: string, @Query('toWarehouseId') toWarehouseId?: string,
  ) {
    return this.transfers.list(t, { page, pageSize, search, status, fromWarehouseId, toWarehouseId });
  }

  @Get('inventory/transfers/:id')
  @Permissions('transfers:read')
  getTransfer(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.transfers.get(t, id);
  }

  @Post('inventory/transfers')
  @Permissions('transfers:manage')
  createTransfer(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.transfers.create(t, u, stockTransferDto.parse(body));
  }

  @Post('inventory/transfers/:id/post')
  @Permissions('transfers:manage')
  postTransfer(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.transfers.post(t, u, id);
  }

  @Post('inventory/transfers/:id/cancel')
  @Permissions('transfers:manage')
  cancelTransfer(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.transfers.cancel(t, u, id);
  }

  @Delete('inventory/transfers/:id')
  @Permissions('transfers:manage')
  deleteTransfer(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.transfers.delete(t, u, id);
  }

  // --- Stock counts ---
  @Get('inventory/counts')
  @Permissions('counts:read')
  listCounts(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('warehouseId') warehouseId?: string,
  ) {
    return this.counts.list(t, { page, pageSize, search, status, warehouseId });
  }

  @Get('inventory/counts/:id')
  @Permissions('counts:read')
  getCount(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.counts.get(t, id);
  }

  @Post('inventory/counts')
  @Permissions('counts:manage')
  createCount(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.counts.create(t, u, stockCountDto.parse(body));
  }

  @Post('inventory/counts/:id/approve')
  @Permissions('counts:manage')
  approveCount(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.counts.approve(t, u, id);
  }

  @Post('inventory/counts/:id/cancel')
  @Permissions('counts:manage')
  cancelCount(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.counts.cancel(t, u, id);
  }

  @Delete('inventory/counts/:id')
  @Permissions('counts:manage')
  deleteCount(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.counts.delete(t, u, id);
  }
}
