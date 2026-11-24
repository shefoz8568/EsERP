import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  milestoneDto,
  milestoneUpdateDto,
  projectDto,
  projectExpenseDto,
  projectExpenseUpdateDto,
  projectTaskDto,
  projectTaskUpdateDto,
  projectUpdateDto,
  timesheetDto,
  timesheetUpdateDto,
} from '@eserp/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { TimesheetsService } from './timesheets.service';
import { ExpensesService } from './expenses.service';
import { MilestonesService } from './milestones.service';
import { CostingService } from './costing.service';

@ApiTags('projects')
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(TimesheetsService) private readonly timesheets: TimesheetsService,
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
    @Inject(MilestonesService) private readonly milestones: MilestonesService,
    @Inject(CostingService) private readonly costing: CostingService,
  ) {}

  // --- Projects ---
  @Get('projects')
  @Permissions('projects:read')
  listProjects(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('status') status?: string,
    @Query('billingType') billingType?: string, @Query('customerId') customerId?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.projects.list(t, { page, pageSize, search, status, billingType, customerId, managerId });
  }

  @Get('projects/:id/costing')
  @Permissions('projects:read')
  projectCosting(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.costing.compute(t, id);
  }

  @Get('projects/:id')
  @Permissions('projects:read')
  getProject(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.projects.get(t, id);
  }

  @Post('projects')
  @Permissions('projects:manage')
  createProject(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.projects.create(t, u, projectDto.parse(body));
  }

  @Patch('projects/:id')
  @Permissions('projects:manage')
  updateProject(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.projects.update(t, u, id, projectUpdateDto.parse(body));
  }

  @Delete('projects/:id')
  @Permissions('projects:manage')
  deleteProject(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.projects.delete(t, u, id);
  }

  // --- Tasks ---
  @Get('project-tasks')
  @Permissions('project-tasks:read')
  listTasks(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('search') search?: string, @Query('projectId') projectId?: string,
    @Query('status') status?: string, @Query('assigneeId') assigneeId?: string,
    @Query('priority') priority?: string,
  ) {
    return this.tasks.list(t, { page, pageSize, search, projectId, status, assigneeId, priority });
  }

  @Get('project-tasks/:id')
  @Permissions('project-tasks:read')
  getTask(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.tasks.get(t, id);
  }

  @Post('project-tasks')
  @Permissions('project-tasks:manage')
  createTask(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.tasks.create(t, u, projectTaskDto.parse(body));
  }

  @Patch('project-tasks/:id')
  @Permissions('project-tasks:manage')
  updateTask(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.tasks.update(t, u, id, projectTaskUpdateDto.parse(body));
  }

  @Delete('project-tasks/:id')
  @Permissions('project-tasks:manage')
  deleteTask(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.tasks.delete(t, u, id);
  }

  // --- Timesheets ---
  @Get('timesheets')
  @Permissions('timesheets:read')
  listTimesheets(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('employeeId') employeeId?: string, @Query('projectId') projectId?: string,
    @Query('taskId') taskId?: string, @Query('status') status?: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.timesheets.list(t, { page, pageSize, employeeId, projectId, taskId, status, from, to });
  }

  @Get('timesheets/:id')
  @Permissions('timesheets:read')
  getTimesheet(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.timesheets.get(t, id);
  }

  @Post('timesheets')
  @Permissions('timesheets:manage')
  createTimesheet(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.timesheets.create(t, u, timesheetDto.parse(body));
  }

  @Patch('timesheets/:id')
  @Permissions('timesheets:manage')
  updateTimesheet(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.timesheets.update(t, u, id, timesheetUpdateDto.parse(body));
  }

  @Post('timesheets/:id/submit')
  @Permissions('timesheets:manage')
  submitTimesheet(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.timesheets.submit(t, u, id);
  }

  @Post('timesheets/:id/approve')
  @Permissions('timesheets:manage')
  approveTimesheet(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.timesheets.approve(t, u, id);
  }

  @Post('timesheets/:id/reject')
  @Permissions('timesheets:manage')
  rejectTimesheet(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.timesheets.reject(t, u, id);
  }

  @Delete('timesheets/:id')
  @Permissions('timesheets:manage')
  deleteTimesheet(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.timesheets.delete(t, u, id);
  }

  // --- Project expenses ---
  @Get('project-expenses')
  @Permissions('project-expenses:read')
  listExpenses(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('projectId') projectId?: string, @Query('status') status?: string,
    @Query('category') category?: string, @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.expenses.list(t, { page, pageSize, projectId, status, category, from, to });
  }

  @Get('project-expenses/:id')
  @Permissions('project-expenses:read')
  getExpense(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.expenses.get(t, id);
  }

  @Post('project-expenses')
  @Permissions('project-expenses:manage')
  createExpense(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.expenses.create(t, u, projectExpenseDto.parse(body));
  }

  @Patch('project-expenses/:id')
  @Permissions('project-expenses:manage')
  updateExpense(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.expenses.update(t, u, id, projectExpenseUpdateDto.parse(body));
  }

  @Post('project-expenses/:id/approve')
  @Permissions('project-expenses:manage')
  approveExpense(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.expenses.approve(t, u, id);
  }

  @Post('project-expenses/:id/reject')
  @Permissions('project-expenses:manage')
  rejectExpense(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.expenses.reject(t, u, id);
  }

  @Delete('project-expenses/:id')
  @Permissions('project-expenses:manage')
  deleteExpense(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.expenses.delete(t, u, id);
  }

  // --- Milestones ---
  @Get('milestones')
  @Permissions('milestones:read')
  listMilestones(
    @CurrentTenantId() t: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('projectId') projectId?: string, @Query('status') status?: string,
  ) {
    return this.milestones.list(t, { page, pageSize, projectId, status });
  }

  @Get('milestones/:id')
  @Permissions('milestones:read')
  getMilestone(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.milestones.get(t, id);
  }

  @Post('milestones')
  @Permissions('milestones:manage')
  createMilestone(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.milestones.create(t, u, milestoneDto.parse(body));
  }

  @Patch('milestones/:id')
  @Permissions('milestones:manage')
  updateMilestone(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string, @Body() body: unknown) {
    return this.milestones.update(t, u, id, milestoneUpdateDto.parse(body));
  }

  @Post('milestones/:id/achieve')
  @Permissions('milestones:manage')
  achieveMilestone(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.milestones.achieve(t, u, id);
  }

  @Delete('milestones/:id')
  @Permissions('milestones:manage')
  deleteMilestone(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Param('id') id: string) {
    return this.milestones.delete(t, u, id);
  }
}
