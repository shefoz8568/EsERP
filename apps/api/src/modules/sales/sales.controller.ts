import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  customerPaymentDto,
  leadDto,
  leadUpdateDto,
  opportunityDto,
  opportunityUpdateDto,
  salesInvoiceDto,
  salesInvoiceUpdateDto,
  salesOrderDto,
  salesOrderUpdateDto,
  salesQuoteDto,
  salesQuoteUpdateDto,
} from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { LeadsService } from './leads.service';
import { OpportunitiesService } from './opportunities.service';
import { QuotesService } from './quotes.service';
import { OrdersService } from './orders.service';
import { SalesInvoicesService } from './invoices.service';
import { CustomerPaymentsService } from './payments.service';
import { SalesReportsService } from './reports.service';

@ApiTags('sales')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class SalesController {
  constructor(
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(QuotesService) private readonly quotes: QuotesService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(SalesInvoicesService) private readonly invoices: SalesInvoicesService,
    @Inject(CustomerPaymentsService) private readonly payments: CustomerPaymentsService,
    @Inject(SalesReportsService) private readonly reports: SalesReportsService,
  ) {}

  // --- Leads ---
  @Get('leads')
  @Permissions('leads:read')
  listLeads(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('source') source?: string,
  ) {
    return this.leads.list(t, { page, pageSize, search, status, source });
  }

  @Get('leads/:id')
  @Permissions('leads:read')
  getLead(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.leads.get(t, id);
  }

  @Post('leads')
  @Permissions('leads:manage')
  createLead(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.leads.create(t, u, leadDto.parse(body));
  }

  @Patch('leads/:id')
  @Permissions('leads:manage')
  updateLead(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.leads.update(t, u, id, leadUpdateDto.parse(body));
  }

  @Post('leads/:id/convert')
  @Permissions('leads:manage')
  convertLead(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.leads.convert(t, u, id);
  }

  @Delete('leads/:id')
  @Permissions('leads:manage')
  deleteLead(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.leads.delete(t, u, id);
  }

  // --- Opportunities ---
  @Get('opportunities')
  @Permissions('opportunities:read')
  listOpportunities(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('stage') stage?: string, @Query('customerId') customerId?: string,
  ) {
    return this.opportunities.list(t, { page, pageSize, search, stage, customerId });
  }

  @Get('opportunities/:id')
  @Permissions('opportunities:read')
  getOpportunity(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.opportunities.get(t, id);
  }

  @Post('opportunities')
  @Permissions('opportunities:manage')
  createOpportunity(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.opportunities.create(t, u, opportunityDto.parse(body));
  }

  @Patch('opportunities/:id')
  @Permissions('opportunities:manage')
  updateOpportunity(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.opportunities.update(t, u, id, opportunityUpdateDto.parse(body));
  }

  @Delete('opportunities/:id')
  @Permissions('opportunities:manage')
  deleteOpportunity(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.opportunities.delete(t, u, id);
  }

  // --- Quotes ---
  @Get('quotes')
  @Permissions('quotes:read')
  listQuotes(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('customerId') customerId?: string,
  ) {
    return this.quotes.list(t, { page, pageSize, search, status, customerId });
  }

  @Get('quotes/:id')
  @Permissions('quotes:read')
  getQuote(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.quotes.get(t, id);
  }

  @Post('quotes')
  @Permissions('quotes:manage')
  createQuote(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.quotes.create(t, u, salesQuoteDto.parse(body));
  }

  @Patch('quotes/:id')
  @Permissions('quotes:manage')
  updateQuote(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.quotes.update(t, u, id, salesQuoteUpdateDto.parse(body));
  }

  @Post('quotes/:id/send')
  @Permissions('quotes:manage')
  sendQuote(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.quotes.send(t, u, id);
  }

  @Post('quotes/:id/accept')
  @Permissions('quotes:manage')
  acceptQuote(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.quotes.accept(t, u, id);
  }

  @Post('quotes/:id/reject')
  @Permissions('quotes:manage')
  rejectQuote(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.quotes.reject(t, u, id);
  }

  @Delete('quotes/:id')
  @Permissions('quotes:manage')
  deleteQuote(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.quotes.delete(t, u, id);
  }

  // --- Sales orders ---
  @Get('sales-orders')
  @Permissions('sales-orders:read')
  listOrders(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('customerId') customerId?: string,
  ) {
    return this.orders.list(t, { page, pageSize, search, status, customerId });
  }

  @Get('sales-orders/:id')
  @Permissions('sales-orders:read')
  getOrder(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.orders.get(t, id);
  }

  @Post('sales-orders')
  @Permissions('sales-orders:manage')
  createOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.orders.create(t, u, salesOrderDto.parse(body));
  }

  @Patch('sales-orders/:id')
  @Permissions('sales-orders:manage')
  updateOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.orders.update(t, u, id, salesOrderUpdateDto.parse(body));
  }

  @Post('sales-orders/:id/confirm')
  @Permissions('sales-orders:manage')
  confirmOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.confirm(t, u, id);
  }

  @Post('sales-orders/:id/cancel')
  @Permissions('sales-orders:manage')
  cancelOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.cancel(t, u, id);
  }

  @Delete('sales-orders/:id')
  @Permissions('sales-orders:manage')
  deleteOrder(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.orders.delete(t, u, id);
  }

  // --- Sales invoices (+ credit notes) ---
  @Get('sales-invoices')
  @Permissions('sales-invoices:read')
  listInvoices(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('type') type?: string, @Query('customerId') customerId?: string, @Query('orderId') orderId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.invoices.list(t, { page, pageSize, search, status, type, customerId, orderId, projectId });
  }

  @Get('sales-invoices/:id')
  @Permissions('sales-invoices:read')
  getInvoice(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.invoices.get(t, id);
  }

  @Post('sales-invoices')
  @Permissions('sales-invoices:manage')
  createInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.invoices.create(t, u, salesInvoiceDto.parse(body));
  }

  @Patch('sales-invoices/:id')
  @Permissions('sales-invoices:manage')
  updateInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.invoices.update(t, u, id, salesInvoiceUpdateDto.parse(body));
  }

  @Post('sales-invoices/:id/post')
  @Permissions('sales-invoices:manage')
  postInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.invoices.post(t, u, id);
  }

  @Post('sales-invoices/:id/void')
  @Permissions('sales-invoices:manage')
  voidInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.invoices.void(t, u, id);
  }

  @Delete('sales-invoices/:id')
  @Permissions('sales-invoices:manage')
  deleteInvoice(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.invoices.delete(t, u, id);
  }

  // --- Customer payments ---
  @Get('customer-payments')
  @Permissions('customer-payments:read')
  listPayments(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('customerId') customerId?: string, @Query('method') method?: string,
  ) {
    return this.payments.list(t, { page, pageSize, search, customerId, method });
  }

  @Get('customer-payments/:id')
  @Permissions('customer-payments:read')
  getPayment(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.payments.get(t, id);
  }

  @Post('customer-payments')
  @Permissions('customer-payments:manage')
  createPayment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.payments.create(t, u, customerPaymentDto.parse(body));
  }

  // --- AR aging report ---
  @Get('reports/ar-aging')
  @Permissions('aging:read')
  arAging(@CurrentTenantId() t: string, @Query('asOf') asOf?: string) {
    return this.reports.arAging(t, asOf);
  }
}
