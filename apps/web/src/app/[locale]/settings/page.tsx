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
  const raw = searchParams.get("tab") ?? "company";
  const tab: TabId = (TABS as readonly string[]).includes(raw) ? (raw as TabId) : "company";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <Tabs
        value={tab}
        onValueChange={(v) => router.push(`/${locale}/settings?tab=${v}`)}
        className="space-y-4"
      >
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          {TABS.map((id) => (
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
