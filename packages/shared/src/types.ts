export type RoleName =
  | 'OWNER'
  | 'ADMIN'
  | 'ACCOUNTANT'
  | 'SALES'
  | 'PURCHASING'
  | 'WAREHOUSE'
  | 'HR'
  | 'VIEWER';

export const ROLE_NAMES: RoleName[] = [
  'OWNER',
  'ADMIN',
  'ACCOUNTANT',
  'SALES',
  'PURCHASING',
  'WAREHOUSE',
  'HR',
  'VIEWER',
];

/** Permission strings are "module:action". "*" expands per-module in the seed. */
export type PermissionName = string;

export const ALL_PERMISSIONS: string[] = [
  'tenants:read', 'tenants:manage', 'tenants:delete',
  'settings:read', 'settings:manage',
  'users:read', 'users:invite', 'users:manage',
  'roles:read', 'roles:manage',
  'audit:read',
  'onboarding:read', 'onboarding:manage',
  'files:read', 'files:upload', 'files:delete',
  'accounting:read', 'accounting:manage',
  'journals:read', 'journals:manage',
  'periods:read', 'periods:manage',
  'cost-centers:read', 'cost-centers:manage',
  'sales:read', 'sales:manage',
  'purchasing:read', 'purchasing:manage',
  'inventory:read', 'inventory:manage',
  'warehouses:read', 'warehouses:manage',
  'stock:read', 'stock:manage',
  'goods-receipts:read', 'goods-receipts:manage',
  'delivery-notes:read', 'delivery-notes:manage',
  'adjustments:read', 'adjustments:manage',
  'transfers:read', 'transfers:manage',
  'counts:read', 'counts:manage',
  'pos:read', 'pos:manage',
  'pos-terminals:read', 'pos-terminals:manage',
  'pos-shifts:read', 'pos-shifts:manage',
  'pos-sales:read', 'pos-sales:manage',
  'contacts:read', 'contacts:manage',
  'items:read', 'items:manage',
  'item-categories:read', 'item-categories:manage',
  'pricelists:read', 'pricelists:manage',
  'leads:read', 'leads:manage',
  'opportunities:read', 'opportunities:manage',
  'quotes:read', 'quotes:manage',
  'sales-orders:read', 'sales-orders:manage',
  'sales-invoices:read', 'sales-invoices:manage',
  'customer-payments:read', 'customer-payments:manage',
  'purchase-orders:read', 'purchase-orders:manage',
  'supplier-invoices:read', 'supplier-invoices:manage',
  'supplier-payments:read', 'supplier-payments:manage',
  'aging:read',
  'hr:read', 'hr:manage',
  'manufacturing:read', 'manufacturing:manage',
  'work-centers:read', 'work-centers:manage',
  'boms:read', 'boms:manage',
  'work-orders:read', 'work-orders:manage',
  'employees:read', 'employees:manage',
  'departments:read', 'departments:manage',
  'leave:read', 'leave:manage',
  'attendance:read', 'attendance:manage',
  'payroll:read', 'payroll:manage', 'payroll:approve',
  'projects:read', 'projects:manage',
  'project-tasks:read', 'project-tasks:manage',
  'timesheets:read', 'timesheets:manage',
  'project-expenses:read', 'project-expenses:manage',
  'milestones:read', 'milestones:manage',
  'analytics:read', 'reports:read', 'reports:manage',
  'ai:read', 'ai:ask',
  'notifications:read', 'notifications:manage',
  'zatca:read', 'zatca:manage',
  'webhooks:read', 'webhooks:manage',
  'api-keys:read', 'api-keys:manage',
  'exports:read', 'exports:manage',
  'hr:read-sensitive',
];

/**
 * Permission matrix used by the seed and by the API's default-role setup.
 * A trailing ":*" means every permission for that module; "*" means all.
 */
export const ROLE_PERMISSION_MATRIX: Record<RoleName, string[]> = {
  OWNER: ['*'],
  ADMIN: ['*', '-tenants:delete'],
  ACCOUNTANT: ['accounting:*', 'journals:*', 'periods:*', 'cost-centers:*', 'sales-invoices:*', 'customer-payments:*', 'supplier-invoices:*', 'supplier-payments:*', 'aging:read', 'audit:read', 'settings:read', 'warehouses:read', 'files:*', 'contacts:read', 'items:read', 'pricelists:read', 'leads:read', 'opportunities:read', 'quotes:read', 'sales-orders:read', 'purchase-orders:read', 'stock:read', 'inventory:read', 'pos:read', 'pos-terminals:read', 'pos-shifts:read', 'pos-sales:read', 'manufacturing:read', 'boms:read', 'work-orders:read', 'work-centers:read', 'employees:read', 'departments:read', 'leave:read', 'attendance:read', 'payroll:read', 'payroll:approve', 'projects:read', 'project-tasks:read', 'timesheets:read', 'project-expenses:read', 'milestones:read', 'analytics:read', 'reports:*', 'ai:*', 'zatca:*', 'exports:*', 'webhooks:read', 'api-keys:read'],
  SALES: ['sales:*', 'leads:*', 'opportunities:*', 'quotes:*', 'sales-orders:*', 'sales-invoices:*', 'customer-payments:*', 'aging:read', 'contacts:*', 'inventory:read', 'stock:read', 'warehouses:read', 'delivery-notes:read', 'items:read', 'pricelists:read', 'accounting:read', 'journals:read', 'purchase-orders:read', 'supplier-invoices:read', 'pos:*', 'pos-terminals:read', 'pos-shifts:*', 'pos-sales:*', 'projects:read', 'project-tasks:read', 'milestones:read', 'analytics:read', 'ai:*', 'zatca:read', 'exports:read'],
  PURCHASING: ['purchasing:*', 'purchase-orders:*', 'supplier-invoices:*', 'supplier-payments:*', 'aging:read', 'inventory:read', 'stock:read', 'goods-receipts:read', 'goods-receipts:manage', 'warehouses:read', 'contacts:*', 'items:read', 'items:manage', 'pricelists:read', 'accounting:read', 'journals:read', 'sales-orders:read', 'sales-invoices:read', 'analytics:read', 'ai:read', 'exports:read'],
  WAREHOUSE: ['inventory:*', 'stock:*', 'goods-receipts:*', 'delivery-notes:*', 'adjustments:*', 'transfers:*', 'counts:*', 'warehouses:manage', 'warehouses:read', 'items:read', 'accounting:read', 'sales-orders:read', 'purchase-orders:read', 'manufacturing:*', 'work-centers:*', 'work-orders:*', 'boms:read', 'analytics:read', 'ai:read', 'exports:read'],
  HR: ['hr:*', 'hr:read-sensitive', 'users:read', 'employees:*', 'departments:*', 'leave:*', 'attendance:*', 'payroll:read', 'payroll:manage', 'timesheets:read', 'analytics:read', 'ai:read', 'exports:read'],
  VIEWER: ['*:read'],
};

/** Expand matrix entries ("*", "module:*", "*:read", "-perm") to concrete permissions. */
export function expandPermissions(entries: string[]): string[] {
  const out = new Set<string>();
  for (const entry of entries) {
    if (entry.startsWith('-')) {
      out.delete(entry.slice(1));
      continue;
    }
    if (entry === '*') {
      for (const p of ALL_PERMISSIONS) out.add(p);
      continue;
    }
    const [mod, act] = entry.split(':');
    if (act === '*') {
      for (const p of ALL_PERMISSIONS) if (p.startsWith(`${mod}:`)) out.add(p);
    } else if (mod === '*') {
      for (const p of ALL_PERMISSIONS) if (p.endsWith(`:${act}`)) out.add(p);
    } else {
      out.add(entry);
    }
  }
  return [...out].sort();
}

export interface TenantContext {
  tenantId: string;
  userId?: string;
  roles?: RoleName[];
  permissions?: string[];
  locale?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export type CalendarType = 'gregorian' | 'hijri';

export interface JwtClaims {
  sub: string;
  tenantId: string;
  email: string;
  roles: RoleName[];
  iat?: number;
  exp?: number;
}
