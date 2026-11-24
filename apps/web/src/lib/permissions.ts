/**
 * Permission catalogue for the Roles permission-matrix editor.
 *
 * Permission names are "module:action" strings from @eserp/shared
 * (ALL_PERMISSIONS — the same catalogue the API seeds into the DB).
 * The matrix is grouped by module for display.
 */
import { ALL_PERMISSIONS as SHARED_PERMISSIONS, ROLE_NAMES } from "@eserp/shared";

export interface PermissionItem {
  key: string;
  label: string;
}

export interface PermissionGroup {
  module: string;
  label: string;
  permissions: PermissionItem[];
}

const MODULE_LABELS: Record<string, string> = {
  tenants: "Tenants",
  settings: "Settings",
  users: "Users",
  roles: "Roles",
  audit: "Audit log",
  onboarding: "Onboarding",
  files: "Files",
  accounting: "Accounting",
  sales: "Sales",
  purchasing: "Purchasing",
  inventory: "Inventory",
  warehouses: "Warehouses",
  contacts: "Contacts",
  items: "Items",
  "item-categories": "Item categories",
  pricelists: "Price lists",
  hr: "HR",
  notifications: "Notifications",
};

function humanizeAction(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export const PERMISSION_GROUPS: PermissionGroup[] = (() => {
  const byModule = new Map<string, PermissionItem[]>();
  for (const name of SHARED_PERMISSIONS) {
    const [module, action] = name.split(":");
    const items = byModule.get(module) ?? [];
    items.push({ key: name, label: `${humanizeAction(action)} ${module}` });
    byModule.set(module, items);
  }
  return [...byModule.entries()].map(([module, permissions]) => ({
    module,
    label: MODULE_LABELS[module] ?? module,
    permissions,
  }));
})();

export const ALL_PERMISSIONS: string[] = [...SHARED_PERMISSIONS];

/** Built-in role names from @eserp/shared (same list the API seeds). */
export const ROLES = ROLE_NAMES;
