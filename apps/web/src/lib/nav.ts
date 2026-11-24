/**
 * Shared shell navigation definition (single source of truth for the
 * sidebar and the command palette). Groups follow the module structure
 * of the app; labels come from the `nav.*` / `shell.groups.*` i18n keys.
 *
 * `requiresAdmin` items (admin-only settings/integrations) are hidden
 * from users without an OWNER/ADMIN role — see Sidebar. When the role
 * list is unavailable/empty they are shown (fail-open: the API still
 * enforces authorisation on every route).
 */
import {
  Bell,
  BookText,
  Briefcase,
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  Contact,
  Factory,
  FileText,
  Handshake,
  Hourglass,
  LayoutDashboard,
  ListOrdered,
  NotebookText,
  Package,
  PieChart,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tags,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export type NavGroupKey =
  | "overview"
  | "sales"
  | "purchasing"
  | "inventory"
  | "pos"
  | "manufacturing"
  | "hr"
  | "projects"
  | "accounting"
  | "analytics"
  | "admin";

export interface NavItem {
  /** Path segment under /[locale]/ (may include a query string). */
  href: string;
  icon: LucideIcon;
  /** i18n key under `nav.*`. */
  key: string;
  group: NavGroupKey;
  /** Hidden unless the user has an OWNER/ADMIN role. */
  requiresAdmin?: boolean;
}

export interface NavGroup {
  key: NavGroupKey;
  items: NavItem[];
}

const item = (
  href: string,
  icon: LucideIcon,
  key: string,
  group: NavGroupKey,
  requiresAdmin = false,
): NavItem => ({ href, icon, key, group, requiresAdmin });

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    items: [item("dashboard", LayoutDashboard, "nav.dashboard", "overview")],
  },
  {
    key: "sales",
    items: [
      item("contacts", Contact, "nav.contacts", "sales"),
      item("leads", UserPlus, "nav.leads", "sales"),
      item("opportunities", Handshake, "nav.opportunities", "sales"),
      item("quotes", FileText, "nav.quotes", "sales"),
      item("sales-orders", ShoppingCart, "nav.salesOrders", "sales"),
      item("sales-invoices", Receipt, "nav.salesInvoices", "sales"),
      item("customer-payments", Wallet, "nav.customerPayments", "sales"),
      item("ar-aging", Hourglass, "nav.arAging", "sales"),
    ],
  },
  {
    key: "purchasing",
    items: [
      item("purchase-orders", Truck, "nav.purchaseOrders", "purchasing"),
      item("supplier-invoices", Receipt, "nav.supplierInvoices", "purchasing"),
      item("supplier-payments", Wallet, "nav.supplierPayments", "purchasing"),
      item("ap-aging", Hourglass, "nav.apAging", "purchasing"),
    ],
  },
  {
    key: "inventory",
    items: [
      item("items", Package, "nav.items", "inventory"),
      item("pricelists", Tags, "nav.priceLists", "inventory"),
      item("stock-levels", Package, "nav.stockLevels", "inventory"),
      item("stock-movements", ListOrdered, "nav.stockMovements", "inventory"),
      item("goods-receipts", Truck, "nav.goodsReceipts", "inventory"),
      item("delivery-notes", FileText, "nav.deliveryNotes", "inventory"),
      item("stock-adjustments", Scale, "nav.stockAdjustments", "inventory"),
      item("stock-transfers", NotebookText, "nav.stockTransfers", "inventory"),
      item("stock-counts", ScrollText, "nav.stockCounts", "inventory"),
      item("low-stock", Hourglass, "nav.lowStock", "inventory"),
    ],
  },
  {
    key: "pos",
    items: [
      item("pos", ShoppingCart, "nav.pos", "pos"),
      item("pos-terminals", Receipt, "nav.posTerminals", "pos"),
      item("pos-shifts", CalendarRange, "nav.posShifts", "pos"),
    ],
  },
  {
    key: "manufacturing",
    items: [
      item("work-centers", Factory, "nav.workCenters", "manufacturing"),
      item("boms", ListOrdered, "nav.boms", "manufacturing"),
      item("work-orders", ClipboardList, "nav.workOrders", "manufacturing"),
      item("material-issues", Package, "nav.materialIssues", "manufacturing"),
      item("production-receipts", Truck, "nav.productionReceipts", "manufacturing"),
      item("scrap", Scale, "nav.scrap", "manufacturing"),
      item("wip-report", PieChart, "nav.wipReport", "manufacturing"),
    ],
  },
  {
    key: "hr",
    items: [
      item("departments", Briefcase, "nav.departments", "hr"),
      item("employees", Users, "nav.employees", "hr"),
      item("leave", CalendarCheck, "nav.leave", "hr"),
      item("attendance", Hourglass, "nav.attendance", "hr"),
      item("payroll-runs", Wallet, "nav.payrollRuns", "hr"),
    ],
  },
  {
    key: "projects",
    items: [
      item("projects", Briefcase, "nav.projects", "projects"),
      item("project-tasks", ClipboardList, "nav.projectTasks", "projects"),
      item("timesheets", Hourglass, "nav.timesheets", "projects"),
      item("project-expenses", Receipt, "nav.projectExpenses", "projects"),
      item("milestones", CalendarCheck, "nav.milestones", "projects"),
    ],
  },
  {
    key: "accounting",
    items: [
      item("journals", BookText, "nav.journals", "accounting"),
      item("trial-balance", Scale, "nav.trialBalance", "accounting"),
      item("general-ledger", NotebookText, "nav.generalLedger", "accounting"),
      item("fiscal-periods", CalendarRange, "nav.fiscalPeriods", "accounting"),
      item("cost-centers", PieChart, "nav.costCenters", "accounting"),
      item("profit-loss", FileText, "nav.profitLoss", "accounting"),
      item("balance-sheet", Scale, "nav.balanceSheet", "accounting"),
      item("cash-flow", Wallet, "nav.cashFlow", "accounting"),
      item("report-snapshots", ScrollText, "nav.reportSnapshots", "accounting"),
    ],
  },
  {
    key: "analytics",
    items: [
      item("analytics-dashboard", PieChart, "nav.analyticsDashboard", "analytics"),
      item("ai-insights", Wand2, "nav.aiInsights", "analytics"),
      item("zatca-documents", Receipt, "nav.zatcaDocuments", "analytics"),
    ],
  },
  {
    key: "admin",
    items: [
      item("settings", Settings, "nav.settings", "admin"),
      item("settings?tab=users", Users, "nav.users", "admin", true),
      item("settings?tab=roles", ShieldCheck, "nav.roles", "admin", true),
      item("settings?tab=audit", ScrollText, "nav.auditLog", "admin", true),
      item("notifications", Bell, "nav.notifications", "admin"),
      item("onboarding", Wand2, "nav.onboarding", "admin"),
      item("webhooks", Bell, "nav.webhooks", "admin", true),
      item("api-keys", ShieldCheck, "nav.apiKeys", "admin", true),
      item("exports", ScrollText, "nav.exports", "admin"),
      item("providers", Settings, "nav.providers", "admin", true),
    ],
  },
];

/** Flat list of every navigable page (71 entries incl. settings tabs). */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Look a nav item up by its href (query string included). */
export function findNavItem(href: string): NavItem | undefined {
  return NAV_ITEMS.find((n) => n.href === href);
}

/** "Create new …" entries for the topbar Create menu (land on the list
 * page, where each module's create form lives — there are no dedicated
 * /new routes in the app). */
export const CREATE_ACTIONS: { href: string; key: string; icon: LucideIcon }[] = [
  { href: "sales-invoices", key: "shell.newSalesInvoice", icon: Receipt },
  { href: "quotes", key: "shell.newQuote", icon: FileText },
  { href: "sales-orders", key: "shell.newSalesOrder", icon: ShoppingCart },
  { href: "purchase-orders", key: "shell.newPurchaseOrder", icon: Truck },
  { href: "contacts", key: "shell.newCustomer", icon: Contact },
  { href: "items", key: "shell.newItem", icon: Package },
  { href: "journals", key: "shell.newJournal", icon: BookText },
];
