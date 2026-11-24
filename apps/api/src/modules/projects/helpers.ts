/**
 * Phase 9 — Projects: shared service helpers (audit + outbox in one tx,
 * reference validation, project lock rules).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { toJson } from '../master-data/serialize';

/** Write the audit row + outbox event for a mutation, inside the caller's tx. */
export async function logAndPublish(
  audit: { log: (entry: any, tx?: any) => Promise<void> },
  outbox: { publish: (tx: any, event: any) => Promise<void> },
  tx: any,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  eventType: string,
  payload: Record<string, unknown>,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  await audit.log(
    { tenantId, actorId, action, entityType, entityId, before: before ? toJson(before) : undefined, after: after ? toJson(after) : undefined },
    tx,
  );
  await outbox.publish(tx, { tenantId, eventType, aggregateId: entityId, payload, createdBy: actorId });
}

/** A project in COMPLETED or CANCELLED status locks time/expense entry. */
export function assertProjectOpenForEntry(project: { status: string; code?: string }): void {
  if (project.status === 'COMPLETED' || project.status === 'CANCELLED') {
    throw new ConflictException(`Project is ${project.status} — time and expense entry is locked`);
  }
}

/** COMPLETED and CANCELLED are terminal: no status transition out of them. */
export function assertStatusTransitionAllowed(current: string, next: string): void {
  if (current === next) return;
  if (current === 'COMPLETED' || current === 'CANCELLED') {
    throw new ConflictException(`A ${current} project cannot change status`);
  }
}

export async function getProjectOr404(tx: any, tenantId: string, projectId: string): Promise<any> {
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.tenantId !== tenantId) throw new NotFoundException('Project not found');
  return project;
}

export async function getCustomerOr404(tx: any, tenantId: string, customerId: string): Promise<any> {
  const customer = await tx.contact.findUnique({ where: { id: customerId } });
  if (!customer || customer.tenantId !== tenantId) throw new NotFoundException('Contact not found');
  if (customer.type !== 'CUSTOMER' && customer.type !== 'BOTH') {
    throw new ConflictException('Project customer must be a CUSTOMER or BOTH contact');
  }
  return customer;
}

export async function getEmployeeOr404(tx: any, tenantId: string, employeeId: string): Promise<any> {
  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!employee || employee.tenantId !== tenantId) throw new NotFoundException('Employee not found');
  return employee;
}

export async function getUserOr404(tx: any, tenantId: string, userId: string): Promise<any> {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.tenantId !== tenantId) throw new NotFoundException('User not found');
  return user;
}
