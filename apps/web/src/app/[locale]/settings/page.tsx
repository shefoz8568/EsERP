"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@eserp/ui";
import { AppShell } from "@/components/AppShell";
import { AuditLogTab } from "@/components/settings/AuditLogTab";
import { CompanyTab } from "@/components/settings/CompanyTab";
import { CurrenciesTab } from "@/components/settings/CurrenciesTab";
import { NumberingTab } from "@/components/settings/NumberingTab";
import { TaxesTab } from "@/components/settings/TaxesTab";
import { UnitsTab } from "@/components/settings/UnitsTab";
import { UsersRolesTab } from "@/components/settings/UsersRolesTab";
import { WarehousesTab } from "@/components/settings/WarehousesTab";

import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

const TABS = [
  "company",
  "currencies",
  "taxes",
  "units",
  "numbering",
  "warehouses",
  "users",
  "roles",
  "audit",
] as const;

type TabId = (typeof TABS)[number];

/**
 * Permission needed to see each tab. The API already 403s the underlying
 * endpoints; hiding the tab keeps users from opening a page that can
 * only show a generic error. Tabs without a settings permission of
 * their own use the module read permission (warehouses:read after the
 * settings controller was aligned to the role matrix).
 */
const TAB_PERMISSIONS: Record<TabId, string> = {
  company: "settings:read",
  currencies: "settings:read",
  taxes: "settings:read",
  units: "settings:read",
  numbering: "settings:read",
  warehouses: "warehouses:read",
  users: "users:read",
  roles: "roles:read",
  audit: "audit:read",
};

const TAB_LABEL_KEYS: Record<TabId, string> = {
  company: "settings.companyProfile",
  currencies: "settings.currencies",
  taxes: "settings.taxes",
  units: "settings.units",
  numbering: "settings.numberingSeries",
  warehouses: "settings.warehouses",
  users: "settings.users",
  roles: "settings.roles",
  audit: "settings.auditLog",
};

function SettingsContent({ locale }: { locale: string }) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const visibleTabs = TABS.filter((id) => hasPermission(user?.permissions, TAB_PERMISSIONS[id]));
  const raw = searchParams.get("tab") ?? visibleTabs[0] ?? "company";
  // A bookmarked / deep-linked tab the user may not see falls back to
  // their first visible tab instead of rendering an error screen.
  const tab: TabId = (visibleTabs as readonly string[]).includes(raw) ? (raw as TabId) : (visibleTabs[0] ?? "company");

  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <Tabs
        value={tab}
        onValueChange={(v) => router.push(`/${locale}/settings?tab=${v}`)}
        className="space-y-4"
      >
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          {visibleTabs.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(TAB_LABEL_KEYS[id] as never)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="company">
          <CompanyTab />
        </TabsContent>
        <TabsContent value="currencies">
          <CurrenciesTab />
        </TabsContent>
        <TabsContent value="taxes">
          <TaxesTab />
        </TabsContent>
        <TabsContent value="units">
          <UnitsTab />
        </TabsContent>
        <TabsContent value="numbering">
          <NumberingTab />
        </TabsContent>
        <TabsContent value="warehouses">
          <WarehousesTab />
        </TabsContent>
        <TabsContent value="users">
          <UsersRolesTab />
        </TabsContent>
        <TabsContent value="roles">
          <UsersRolesTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLogTab locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  return (
    <AppShell locale={locale}>
      <Suspense>
        <SettingsContent locale={locale} />
      </Suspense>
    </AppShell>
  );
}
