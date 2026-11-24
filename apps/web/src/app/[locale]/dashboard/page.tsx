"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Package,
  RotateCcw,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@eserp/ui";
import {
  accountingApi,
  asList,
  asTotal,
  auditApi,
  inventoryApi,
  onboardingApi,
  purchasingApi,
  salesApi,
  settingsApi,
  usersApi,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { companyDisplayName, isOnboardingComplete } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { StatCard } from "@/components/StatCard";

/**
 * Role-based dashboard (research #7, Business Central Role Centers /
 * Fiori My Home): one home per role — Accountant / Sales / Warehouse —
 * built only from existing widgets and existing API endpoints.
 * KPI cue tiles first, one trend chart, one "needs attention" list.
 * Sections can be hidden, reordered and reset; the layout and the chosen
 * role persist in localStorage on this device.
 */

type Role = "accountant" | "sales" | "warehouse";

const ROLES: Role[] = ["accountant", "sales", "warehouse"];

const SECTION_IDS = ["kpis", "trend", "attention", "activity", "next-steps"] as const;
type SectionId = (typeof SECTION_IDS)[number];

function inferRole(roles: string[] | undefined): Role {
  const joined = (roles ?? []).join(" ").toLowerCase();
  if (/sales/.test(joined)) return "sales";
  if (/warehouse|inventory|stock/.test(joined)) return "warehouse";
  return "accountant";
}

function loadLayout(role: Role): { order: SectionId[]; hidden: SectionId[] } {
  const fallback = { order: [...SECTION_IDS] as SectionId[], hidden: [] as SectionId[] };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`eserp:dashboard:layout:${role}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { order?: unknown; hidden?: unknown };
    const order = Array.isArray(parsed.order)
      ? (parsed.order.filter((s): s is SectionId => SECTION_IDS.includes(s as SectionId)))
      : fallback.order;
    const hidden = Array.isArray(parsed.hidden)
      ? (parsed.hidden.filter((s): s is SectionId => SECTION_IDS.includes(s as SectionId)))
      : [];
    const missing = SECTION_IDS.filter((s) => !order.includes(s));
    return { order: [...order, ...missing], hidden };
  } catch {
    return fallback;
  }
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Last 6 calendar months, oldest first, with totals summed from dated rows. */
function monthlyTotals(rows: { date: string; amountMinor: number }[]): { key: string; totalMinor: number }[] {
  const months: { key: string; totalMinor: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), totalMinor: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const row of rows) {
    const bucket = byKey.get(row.date.slice(0, 7));
    if (bucket) bucket.totalMinor += row.amountMinor;
  }
  return months;
}

export default function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const t = useTranslations();
  const { user } = useAuth();

  const [role, setRole] = useState<Role>("accountant");
  const [layout, setLayout] = useState<{ order: SectionId[]; hidden: SectionId[] }>(() =>
    loadLayout("accountant"),
  );

  // Role: stored choice wins; otherwise infer from the user's roles.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("eserp:dashboard:role");
      if (stored && (ROLES as string[]).includes(stored)) {
        setRole(stored as Role);
        setLayout(loadLayout(stored as Role));
        return;
      }
    } catch {
      /* Storage unavailable: fall through to inference. */
    }
    const inferred = inferRole(user?.roles);
    setRole(inferred);
    setLayout(loadLayout(inferred));
  }, [user?.roles]);

  const changeRole = (next: Role) => {
    setRole(next);
    setLayout(loadLayout(next));
    try {
      window.localStorage.setItem("eserp:dashboard:role", next);
    } catch {
      /* Storage unavailable: the choice lives for this session only. */
    }
  };

  const persistLayout = (next: { order: SectionId[]; hidden: SectionId[] }) => {
    setLayout(next);
    try {
      window.localStorage.setItem(`eserp:dashboard:layout:${role}`, JSON.stringify(next));
    } catch {
      /* Storage unavailable: layout lives for this session only. */
    }
  };
  const hideSection = (sectionId: SectionId) =>
    persistLayout({ ...layout, hidden: [...layout.hidden, sectionId] });
  const showSection = (sectionId: SectionId) =>
    persistLayout({ ...layout, hidden: layout.hidden.filter((s) => s !== sectionId) });
  const moveSection = (sectionId: SectionId, direction: -1 | 1) => {
    const order = [...layout.order];
    const i = order.indexOf(sectionId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    persistLayout({ ...layout, order });
  };
  const resetLayout = () =>
    persistLayout({ order: [...SECTION_IDS] as SectionId[], hidden: [] });

  const company = useQuery({ queryKey: ["company"], queryFn: () => settingsApi.getCompany() });
  const users = useQuery({ queryKey: ["users"], queryFn: () => usersApi.list() });
  const warehouses = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => settingsApi.listWarehouses(),
  });
  const currencies = useQuery({
    queryKey: ["currencies"],
    queryFn: () => settingsApi.listCurrencies(),
  });
  const activity = useQuery({
    queryKey: ["audit-logs", "recent"],
    queryFn: () => auditApi.list({ page: 1, pageSize: 10 }),
  });
  const onboarding = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => onboardingApi.get(),
  });
  // Role data — all existing endpoints, small pages.
  const invoices = useQuery({
    queryKey: ["sales-invoices", "dashboard"],
    queryFn: () => salesApi.listInvoices({ pageSize: 100 }),
  });
  const salesOrders = useQuery({
    queryKey: ["sales-orders", "dashboard"],
    queryFn: () => salesApi.listOrders({ pageSize: 100 }),
  });
  const purchaseOrders = useQuery({
    queryKey: ["purchase-orders", "dashboard"],
    queryFn: () => purchasingApi.listOrders({ pageSize: 100 }),
  });
  const draftJournals = useQuery({
    queryKey: ["journals", "draft", "dashboard"],
    queryFn: () => accountingApi.listJournals({ status: "DRAFT", pageSize: 5 }),
  });
  const lowStock = useQuery({
    queryKey: ["low-stock", "dashboard"],
    queryFn: () => inventoryApi.lowStock(),
  });
  const arAging = useQuery({ queryKey: ["ar-aging", "dashboard"], queryFn: () => salesApi.arAging() });
  const apAging = useQuery({ queryKey: ["ap-aging", "dashboard"], queryFn: () => purchasingApi.apAging() });

  const failed = company.isError || users.isError || activity.isError;
  const companyName = companyDisplayName(company.data);
  const onboardingDone = isOnboardingComplete(onboarding.data);

  const invoiceList = useMemo(() => asList(invoices.data), [invoices.data]);
  const today = new Date().toISOString().slice(0, 10);
  const overdueInvoices = useMemo(
    () =>
      invoiceList.filter(
        (i) => i.dueDate.slice(0, 10) < today && !["PAID", "VOID"].includes(i.status),
      ),
    [invoiceList, today],
  );
  const unpaidInvoices = useMemo(
    () => invoiceList.filter((i) => ["POSTED", "PARTIALLY_PAID"].includes(i.status)),
    [invoiceList],
  );
  const openSalesOrders = useMemo(
    () => asList(salesOrders.data).filter((o) => ["DRAFT", "CONFIRMED"].includes(o.status)),
    [salesOrders.data],
  );
  const openPurchaseOrders = useMemo(
    () => asList(purchaseOrders.data).filter((o) => ["DRAFT", "SENT", "CONFIRMED"].includes(o.status)),
    [purchaseOrders.data],
  );
  const lowStockList = useMemo(() => lowStock.data?.data ?? [], [lowStock.data]);
  const lowStockTotal = lowStock.data?.meta.total ?? 0;

  const trendSource =
    role === "warehouse"
      ? asList(purchaseOrders.data).map((o) => ({
          date: o.expectedDate ?? today,
          amountMinor: o.totalMinor,
        }))
      : invoiceList.map((i) => ({ date: i.invoiceDate, amountMinor: i.totalMinor }));
  const trend = useMemo(() => monthlyTotals(trendSource), [trendSource]);
  const trendMax = Math.max(1, ...trend.map((m) => m.totalMinor));

  const attentionItems: { key: string; label: string; detail: string; href: string }[] =
    role === "accountant"
      ? [
          ...overdueInvoices.slice(0, 5).map((i) => ({
            key: `inv-${i.id}`,
            label: `${i.number} · ${i.customer?.displayName ?? ""}`,
            detail: `${t("common.overdue")} · ${formatMoney(i.totalMinor - i.paidMinor, i.currency, locale)}`,
            href: `/${locale}/sales-invoices`,
          })),
          ...asList(draftJournals.data).map((j) => ({
            key: `j-${j.id}`,
            label: `${j.number} · ${j.description}`,
            detail: t("dashboard.draftJournals"),
            href: `/${locale}/journals/${j.id}`,
          })),
        ]
      : role === "sales"
        ? [
            ...unpaidInvoices.slice(0, 5).map((i) => ({
              key: `inv-${i.id}`,
              label: `${i.number} · ${i.customer?.displayName ?? ""}`,
              detail: `${t("sales.dueDate")}: ${i.dueDate.slice(0, 10)} · ${formatMoney(i.totalMinor - i.paidMinor, i.currency, locale)}`,
              href: `/${locale}/sales-invoices`,
            })),
            ...openSalesOrders.slice(0, 5).map((o) => ({
              key: `ord-${o.id}`,
              label: `${o.number} · ${o.customer?.displayName ?? ""}`,
              detail: o.status,
              href: `/${locale}/sales-orders`,
            })),
          ]
        : [
            ...lowStockList.slice(0, 5).map((s) => ({
              key: `stock-${s.id}`,
              label: `${s.item?.sku ?? ""} · ${s.item?.name ?? ""}`,
              detail: `${t("inventory.onHand")}: ${s.qtyOnHand} · ${t("inventory.reorderPoint")}: ${s.item?.reorderPoint ?? 0}`,
              href: `/${locale}/stock-levels`,
            })),
            ...openPurchaseOrders.slice(0, 5).map((o) => ({
              key: `po-${o.id}`,
              label: `${o.number} · ${o.supplier?.displayName ?? ""}`,
              detail: o.status,
              href: `/${locale}/purchase-orders`,
            })),
          ];

  const kpis =
    role === "accountant" ? (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("dashboard.overdueInvoices")} value={String(overdueInvoices.length)} icon={AlertTriangle} loading={invoices.isLoading} />
        <StatCard title={t("dashboard.totalReceivable")} value={formatMoney(arAging.data?.totals.totalMinor ?? 0, "SAR", locale)} icon={Wallet} loading={arAging.isLoading} />
        <StatCard title={t("dashboard.totalPayable")} value={formatMoney(apAging.data?.totals.totalMinor ?? 0, "SAR", locale)} icon={Wallet} loading={apAging.isLoading} />
        <StatCard title={t("dashboard.draftJournals")} value={String(asTotal(draftJournals.data))} icon={AlertTriangle} loading={draftJournals.isLoading} />
      </div>
    ) : role === "sales" ? (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("dashboard.unpaidInvoices")} value={String(unpaidInvoices.length)} icon={Wallet} loading={invoices.isLoading} />
        <StatCard title={t("dashboard.openOrders")} value={String(openSalesOrders.length)} icon={Package} loading={salesOrders.isLoading} />
        <StatCard title={t("dashboard.overdueInvoices")} value={String(overdueInvoices.length)} icon={AlertTriangle} loading={invoices.isLoading} />
        <StatCard title={t("dashboard.totalReceivable")} value={formatMoney(arAging.data?.totals.totalMinor ?? 0, "SAR", locale)} icon={Wallet} loading={arAging.isLoading} />
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={t("dashboard.lowStockItems")} value={String(lowStockTotal)} icon={AlertTriangle} loading={lowStock.isLoading} />
        <StatCard title={t("dashboard.openOrders")} value={String(openPurchaseOrders.length)} icon={Package} loading={purchaseOrders.isLoading} />
        <StatCard title={t("dashboard.warehouses")} value={String(asList(warehouses.data).length)} icon={Building2} loading={warehouses.isLoading} />
        <StatCard title={t("dashboard.users")} value={String(asTotal(users.data))} icon={Users} loading={users.isLoading} />
      </div>
    );

  const sections: Record<SectionId, { title: string; content: React.ReactNode }> = {
    kpis: {
      title: t("dashboard.quickStats"),
      content: kpis,
    },
    trend: {
      title: t("dashboard.monthlyTrend"),
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.monthlyTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Time axis reads left-to-right in both locales; numbers are not flipped. */}
            <div dir="ltr" className="flex h-40 items-end gap-2" role="img" aria-label={t("dashboard.monthlyTrend")}>
              {trend.map((m) => (
                <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {m.totalMinor > 0 ? (m.totalMinor / 100).toLocaleString(locale) : ""}
                  </span>
                  <div
                    className="w-full max-w-12 rounded-t bg-primary"
                    style={{ height: `${Math.max(m.totalMinor > 0 ? 4 : 1, (m.totalMinor / trendMax) * 100)}%` }}
                    title={`${m.key}: ${formatMoney(m.totalMinor, "SAR", locale)}`}
                  />
                  <span className="text-xs text-muted-foreground">{m.key.slice(5)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ),
    },
    attention: {
      title: t("common.needsAttention"),
      content: (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              {t("common.needsAttention")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attentionItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noAttention")}</p>
            ) : (
              <ul className="divide-y">
                {attentionItems.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-4 rounded-sm py-2 text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-medium">{item.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ),
    },
    activity: {
      title: t("dashboard.recentActivity"),
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.recentActivity")}</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : asList(activity.data).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noActivity")}</p>
            ) : (
              <ul className="divide-y">
                {asList(activity.data).map((log) => (
                  <li key={log.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span>
                      <span className="font-medium">{log.action}</span>
                      <span className="text-muted-foreground"> · {log.entityType}</span>
                      {log.actorId && (
                        <span className="text-muted-foreground"> · {log.actorId}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString(locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ),
    },
    "next-steps": {
      title: t("dashboard.nextSteps"),
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.nextSteps")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!onboardingDone ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("dashboard.completeOnboardingHint")}
                </p>
                <Link href={`/${locale}/onboarding`}>
                  <Button className="w-full">
                    {t("dashboard.completeOnboarding")}
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Button>
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("onboarding.completeTitle")}</p>
            )}
            <Link
              href={`/${locale}/settings`}
              className="block rounded-sm text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("common.settings")}
            </Link>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.users")}: {asTotal(users.data)} · {t("dashboard.warehouses")}:{" "}
              {asList(warehouses.data).length} · {t("dashboard.currencies")}:{" "}
              {asList(currencies.data).length}
            </p>
          </CardContent>
        </Card>
      ),
    },
  };

  const visibleSections = layout.order.filter((s) => !layout.hidden.includes(s));
  const hiddenSections = layout.order.filter((s) => layout.hidden.includes(s));

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">
            {t("dashboard.welcome")}
            {user?.name ? `, ${user.name}` : ""}
          </h1>
          {companyName && (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" aria-hidden />
              {companyName}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("dashboard.role")}>
          <span className="text-sm font-medium text-muted-foreground">{t("dashboard.role")}:</span>
          {ROLES.map((r) => (
            <Button
              key={r}
              type="button"
              size="sm"
              variant={role === r ? "default" : "outline"}
              aria-pressed={role === r}
              onClick={() => changeRole(r)}
            >
              {t(`dashboard.${r}` as never)}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={resetLayout}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t("dashboard.resetLayout")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("dashboard.customizeHint")}</p>

        {failed ? (
          <ErrorState
            onRetry={() => {
              void company.refetch();
              void users.refetch();
              void activity.refetch();
            }}
          />
        ) : (
          <div className="space-y-6">
            {visibleSections.map((sectionId) => (
              <section key={sectionId} aria-label={sections[sectionId].title}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {sections[sectionId].title}
                  </h2>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`${t("common.moveUp")}: ${sections[sectionId].title}`}
                      disabled={layout.order.indexOf(sectionId) === 0}
                      onClick={() => moveSection(sectionId, -1)}
                    >
                      <ChevronUp className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`${t("common.moveDown")}: ${sections[sectionId].title}`}
                      disabled={layout.order.indexOf(sectionId) === layout.order.length - 1}
                      onClick={() => moveSection(sectionId, 1)}
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`${t("common.hide")}: ${sections[sectionId].title}`}
                      onClick={() => hideSection(sectionId)}
                    >
                      <EyeOff className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                {sections[sectionId].content}
              </section>
            ))}
            {hiddenSections.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Eye className="h-4 w-4" aria-hidden />
                {hiddenSections.map((sectionId) => (
                  <Button
                    key={sectionId}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => showSection(sectionId)}
                  >
                    {t("common.show")}: {sections[sectionId].title}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
