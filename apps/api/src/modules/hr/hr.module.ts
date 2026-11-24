import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { DepartmentsService } from './departments.service';
import { EmployeesService } from './employees.service';
import { LeaveService } from './leave.service';
import { AttendanceService } from './attendance.service';
import { PayrollService } from './payroll.service';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [AuditModule, QueueModule, AccountingModule, InventoryModule],
  providers: [DepartmentsService, EmployeesService, LeaveService, AttendanceService, PayrollService],
  controllers: [HrController],
  exports: [DepartmentsService, EmployeesService, LeaveService, AttendanceService, PayrollService],
})
export class HrModule {}
