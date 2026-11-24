import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  attendanceBulkDto,
  attendanceRecordDto,
  departmentDto,
  departmentUpdateDto,
  employeeDto,
  employeeTerminateDto,
  employeeUpdateDto,
  leaveRequestDecisionDto,
  leaveRequestDto,
  leaveTypeDto,
  leaveTypeUpdateDto,
  payrollCalculateDto,
  payrollPayDto,
  payrollRunDto,
} from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { DepartmentsService } from './departments.service';
import { EmployeesService } from './employees.service';
import { LeaveService } from './leave.service';
import { AttendanceService } from './attendance.service';
import { PayrollService } from './payroll.service';

@ApiTags('hr')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class HrController {
  constructor(
    @Inject(DepartmentsService) private readonly departments: DepartmentsService,
    @Inject(EmployeesService) private readonly employees: EmployeesService,
    @Inject(LeaveService) private readonly leave: LeaveService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(PayrollService) private readonly payroll: PayrollService,
  ) {}

  // --- Departments ---
  @Get('hr/departments')
  @Permissions('departments:read')
  listDepartments(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('parentId') parentId?: string,
  ) {
    return this.departments.list(t, { page, pageSize, search, status, parentId });
  }

  @Get('hr/departments/:id')
  @Permissions('departments:read')
  getDepartment(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.departments.get(t, id);
  }

  @Post('hr/departments')
  @Permissions('departments:manage')
  createDepartment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.departments.create(t, u, departmentDto.parse(body));
  }

  @Patch('hr/departments/:id')
  @Permissions('departments:manage')
  updateDepartment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.departments.update(t, u, id, departmentUpdateDto.parse(body));
  }

  @Delete('hr/departments/:id')
  @Permissions('departments:manage')
  deleteDepartment(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.departments.delete(t, u, id);
  }

  // --- Employees ---
  // Phase 11: national ID / IBAN are masked unless the caller has
  // `hr:read-sensitive` (OWNER '*' counts too). PermissionsGuard caches the
  // caller's permissions on req.permissions for the request.
  private canReadSensitive(req: { permissions?: string[] }): boolean {
    const perms = req.permissions ?? [];
    return perms.includes('*') || perms.includes('hr:read-sensitive');
  }

  @Get('hr/employees')
  @Permissions('employees:read')
  listEmployees(
    @CurrentTenantId() t: string,
    @Req() req: { permissions?: string[] },
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('departmentId') departmentId?: string, @Query('nationality') nationality?: string,
  ) {
    return this.employees.list(t, { page, pageSize, search, status, departmentId, nationality }, this.canReadSensitive(req));
  }

  @Get('hr/employees/:id')
  @Permissions('employees:read')
  getEmployee(@CurrentTenantId() t: string, @Req() req: { permissions?: string[] }, @Param('id') id: string) {
    return this.employees.get(t, id, this.canReadSensitive(req));
  }

  @Post('hr/employees')
  @Permissions('employees:manage')
  createEmployee(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.employees.create(t, u, employeeDto.parse(body));
  }

  @Patch('hr/employees/:id')
  @Permissions('employees:manage')
  updateEmployee(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.employees.update(t, u, id, employeeUpdateDto.parse(body));
  }

  @Post('hr/employees/:id/terminate')
  @Permissions('employees:manage')
  terminateEmployee(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.employees.terminate(t, u, id, employeeTerminateDto.parse(body).endDate);
  }

  @Delete('hr/employees/:id')
  @Permissions('employees:manage')
  deleteEmployee(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.employees.delete(t, u, id);
  }

  // --- Leave types ---
  @Get('hr/leave-types')
  @Permissions('leave:read')
  listLeaveTypes(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
  ) {
    return this.leave.listTypes(t, { page, pageSize, search, status });
  }

  @Get('hr/leave-types/:id')
  @Permissions('leave:read')
  getLeaveType(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.leave.getType(t, id);
  }

  @Post('hr/leave-types')
  @Permissions('leave:manage')
  createLeaveType(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.leave.createType(t, u, leaveTypeDto.parse(body));
  }

  @Patch('hr/leave-types/:id')
  @Permissions('leave:manage')
  updateLeaveType(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.leave.updateType(t, u, id, leaveTypeUpdateDto.parse(body));
  }

  @Delete('hr/leave-types/:id')
  @Permissions('leave:manage')
  deleteLeaveType(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.leave.deleteType(t, u, id);
  }

  // --- Leave requests + balances ---
  @Get('hr/leave-requests')
  @Permissions('leave:read')
  listLeaveRequests(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('employeeId') employeeId?: string, @Query('leaveTypeId') leaveTypeId?: string, @Query('status') status?: string,
  ) {
    return this.leave.listRequests(t, { page, pageSize, employeeId, leaveTypeId, status });
  }

  @Get('hr/leave-requests/:id')
  @Permissions('leave:read')
  getLeaveRequest(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.leave.getRequest(t, id);
  }

  @Post('hr/leave-requests')
  @Permissions('leave:manage')
  createLeaveRequest(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.leave.createRequest(t, u, leaveRequestDto.parse(body));
  }

  @Post('hr/leave-requests/:id/approve')
  @Permissions('leave:manage')
  approveLeaveRequest(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.leave.approve(t, u, id, leaveRequestDecisionDto.parse(body ?? {}).approverId);
  }

  @Post('hr/leave-requests/:id/reject')
  @Permissions('leave:manage')
  rejectLeaveRequest(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.leave.reject(t, u, id, leaveRequestDecisionDto.parse(body ?? {}).approverId);
  }

  @Post('hr/leave-requests/:id/cancel')
  @Permissions('leave:manage')
  cancelLeaveRequest(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.leave.cancel(t, u, id);
  }

  @Get('hr/leave-balances')
  @Permissions('leave:read')
  leaveBalances(@CurrentTenantId() t: string, @Query('employeeId') employeeId: string, @Query('year') year?: string) {
    if (!employeeId) throw new BadRequestException('employeeId query parameter is required');
    return this.leave.balances(t, employeeId, Number(year) || new Date().getUTCFullYear());
  }

  // --- Attendance ---
  @Get('hr/attendance')
  @Permissions('attendance:read')
  listAttendance(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('employeeId') employeeId?: string, @Query('status') status?: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.attendance.list(t, { page, pageSize, employeeId, status, from, to });
  }

  @Post('hr/attendance')
  @Permissions('attendance:manage')
  createAttendance(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.attendance.create(t, u, attendanceRecordDto.parse(body));
  }

  @Post('hr/attendance/bulk')
  @Permissions('attendance:manage')
  bulkAttendance(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.attendance.bulk(t, u, attendanceBulkDto.parse(body));
  }

  @Get('hr/attendance/summary')
  @Permissions('attendance:read')
  attendanceSummary(
    @CurrentTenantId() t: string,
    @Query('year') year: string, @Query('month') month: string, @Query('employeeId') employeeId?: string,
  ) {
    const y = Number(year);
    const m = Number(month);
    if (!year || !month || !Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      throw new BadRequestException('year and month query parameters are required and must be valid numbers (month 1-12)');
    }
    return this.attendance.monthlySummary(t, y, m, employeeId);
  }

  @Patch('hr/attendance/:id')
  @Permissions('attendance:manage')
  updateAttendance(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.attendance.update(t, u, id, attendanceRecordDto.partial().parse(body));
  }

  @Delete('hr/attendance/:id')
  @Permissions('attendance:manage')
  deleteAttendance(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.attendance.delete(t, u, id);
  }

  // --- Payroll runs ---
  @Get('hr/payroll-runs')
  @Permissions('payroll:read')
  listPayrollRuns(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('status') status?: string, @Query('periodYear') periodYear?: string, @Query('periodMonth') periodMonth?: string,
  ) {
    return this.payroll.list(t, { page, pageSize, status, periodYear, periodMonth });
  }

  @Get('hr/payroll-runs/:id')
  @Permissions('payroll:read')
  getPayrollRun(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.payroll.get(t, id);
  }

  @Post('hr/payroll-runs')
  @Permissions('payroll:manage')
  createPayrollRun(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.payroll.create(t, u, payrollRunDto.parse(body));
  }

  @Post('hr/payroll-runs/:id/calculate')
  @Permissions('payroll:manage')
  calculatePayrollRun(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.payroll.calculate(t, u, id, payrollCalculateDto.parse(body ?? {}));
  }

  @Post('hr/payroll-runs/:id/approve')
  @Permissions('payroll:approve')
  approvePayrollRun(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.payroll.approve(t, u, id);
  }

  @Post('hr/payroll-runs/:id/pay')
  @Permissions('payroll:approve')
  payPayrollRun(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.payroll.pay(t, u, id, payrollPayDto.parse(body));
  }

  @Delete('hr/payroll-runs/:id')
  @Permissions('payroll:manage')
  deletePayrollRun(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.payroll.delete(t, u, id);
  }
}
