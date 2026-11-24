"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input, Label } from "@eserp/ui";
import { salesApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { ArAging } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

type Row = ArAging["customers"][number];

export default function ArAgingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  const query = useQuery({
    queryKey: ["ar-aging", asOf],
    queryFn: () => salesApi.arAging(`${asOf}T00:00:00.000Z`),
  });
  const aging = query.data;

  const columns: ColumnDef<Row>[] = [
    { accessorKey: "customerName", header: t("sales.customer") },
    { accessorKey: "currentMinor", header: t("sales.current"), cell: ({ row }) => formatMoney(row.original.currentMinor, "SAR", locale) },
    { accessorKey: "d1_30Minor", header: t("sales.days130"), cell: ({ row }) => formatMoney(row.original.d1_30Minor, "SAR", locale) },
    { accessorKey: "d31_60Minor", header: t("sales.days3160"), cell: ({ row }) => formatMoney(row.original.d31_60Minor, "SAR", locale) },
    { accessorKey: "d61_90Minor", header: t("sales.days6190"), cell: ({ row }) => formatMoney(row.original.d61_90Minor, "SAR", locale) },
    { accessorKey: "d90PlusMinor", header: t("sales.days90plus"), cell: ({ row }) => formatMoney(row.original.d90PlusMinor, "SAR", locale) },
    { accessorKey: "totalMinor", header: t("sales.total"), cell: ({ row }) => formatMoney(row.original.totalMinor, "SAR", locale) },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("sales.arAging")}</h1>
          <div className="flex items-center gap-2">
            <Label>{t("sales.asOf")}</Label>
            <Input type="date" className="w-44" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
        </div>

        {aging && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {(
              [
                ["current", aging.totals.currentMinor],
                ["1–30", aging.totals.d1_30Minor],
                ["31–60", aging.totals.d31_60Minor],
                ["61–90", aging.totals.d61_90Minor],
                ["90+", aging.totals.d90PlusMinor],
                ["total", aging.totals.totalMinor],
              ] as const
            ).map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">{label === "total" ? t("sales.total") : label === "current" ? t("sales.current") : label}</CardTitle></CardHeader>
                <CardContent><p className="text-lg font-bold">{formatMoney(value, "SAR", locale)}</p></CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="pt-6">
            {query.isError ? (
              <ErrorState onRetry={() => void query.refetch()} />
            ) : (
              <DataTable columns={columns} data={aging?.customers ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
