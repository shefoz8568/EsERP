import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  purchaseOrderDto,
  purchaseOrderUpdateDto,
  supplierInvoiceDto,
  supplierInvoiceUpdateDto,
  supplierPaymentDto,
} from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { PurchasingReportsService } from './reports.service';

@ApiTags('purchasing')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class PurchasingController {
  constructor(
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
    @Inject(SupplierInvoicesService) private readonly invoices: SupplierInvoicesService,
    @Inject(SupplierPaymentsService) private readonly payments: SupplierPaymentsService,
    @Inject(PurchasingReportsService) private readonly reports: PurchasingReportsService,
  ) {}

  // --- Purchase orders ---
  @Get('purchase-orders')
  @Permissions('purchase-orders:read')
  listOrders(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('supplierId') supplierId?: string,
  ) {
    return this.orders.list(t, { page, pageSize, search, status, supplierId });
  }

  @Get('purchase-orders/:id')
  @Permissions('purchase-orders:read')
  getOrder(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.orders.get(t, id);
  }

  @Post('purchase-orders')
  @Permissions('purchase-orders:manage')
  createOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.orders.create(t, u, purchaseOrderDto.parse(body));
  }

  @Patch('purchase-orders/:id')
  @Permissions('purchase-orders:manage')
  updateOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.orders.update(t, u, id, purchaseOrderUpdateDto.parse(body));
  }

  @Post('purchase-orders/:id/send')
  @Permissions('purchase-orders:manage')
  sendOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.send(t, u, id);
  }

  @Post('purchase-orders/:id/confirm')
  @Permissions('purchase-orders:manage')
  confirmOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.confirm(t, u, id);
  }

  @Post('purchase-orders/:id/close')
  @Permissions('purchase-orders:manage')
  closeOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.close(t, u, id);
  }

  @Post('purchase-orders/:id/cancel')
  @Permissions('purchase-orders:manage')
  cancelOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.cancel(t, u, id);
  }

  @Delete('purchase-orders/:id')
  @Permissions('purchase-orders:manage')
  deleteOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.delete(t, u, id);
  }

  // --- Supplier invoices ---
  @Get('supplier-invoices')
  @Permissions('supplier-invoices:read')
  listInvoices(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('supplierId') supplierId?: string, @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    return this.invoices.list(t, { page, pageSize, search, status, supplierId, purchaseOrderId });
  }

  @Get('supplier-invoices/:id')
  @Permissions('supplier-invoices:read')
  getInvoice(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.invoices.get(t, id);
  }

  @Post('supplier-invoices')
  @Permissions('supplier-invoices:manage')
  createInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.invoices.create(t, u, supplierInvoiceDto.parse(body));
  }

  @Patch('supplier-invoices/:id')
  @Permissions('supplier-invoices:manage')
  updateInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.invoices.update(t, u, id, supplierInvoiceUpdateDto.parse(body));
  }

  @Post('supplier-invoices/:id/post')
  @Permissions('supplier-invoices:manage')
  postInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.invoices.post(t, u, id);
  }

  @Post('supplier-invoices/:id/void')
  @Permissions('supplier-invoices:manage')
  voidInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.invoices.void(t, u, id);
  }

  @Delete('supplier-invoices/:id')
  @Permissions('supplier-invoices:manage')
  deleteInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.invoices.delete(t, u, id);
  }

  // --- Supplier payments ---
  @Get('supplier-payments')
  @Permissions('supplier-payments:read')
  listPayments(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('supplierId') supplierId?: string, @Query('method') method?: string,
  ) {
    return this.payments.list(t, { page, pageSize, search, supplierId, method });
  }

  @Get('supplier-payments/:id')
  @Permissions('supplier-payments:read')
  getPayment(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.payments.get(t, id);
  }

  @Post('supplier-payments')
  @Permissions('supplier-payments:manage')
  createPayment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.payments.create(t, u, supplierPaymentDto.parse(body));
  }

  // --- AP aging report ---
  @Get('reports/ap-aging')
  @Permissions('aging:read')
  apAging(@CurrentTenantId() t: string, @Query('asOf') asOf?: string) {
    return this.reports.apAging(t, asOf);
  }
}
