"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { accountingApi, asList, asTotal } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { FiscalPeriod } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function FiscalPeriodsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));

  const query = useQuery({ queryKey: ["fiscal-periods"], queryFn: () => accountingApi.listPeriods({ pageSize: 100 }) });
  const periods = asList<FiscalPeriod>(query.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["fiscal-periods"] });

  const create = useMutation({
    mutationFn: () => {
      const y = Number(year);
      const m = Number(month);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return accountingApi.createPeriod({
        fiscalYear: y,
        periodNumber: m,
        startDate: `${y}-${String(m).padStart(2, "0")}-01T00:00:00.000Z`,
        endDate: `${y}-${String(m).padStart(2, "0")}-${lastDay}T23:59:59.999Z`,
        status: "OPEN",
      });
    },
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => accountingApi.updatePeriodStatus(id, status),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => accountingApi.deletePeriod(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<FiscalPeriod>[] = [
    { accessorKey: "fiscalYear", header: t("accounting.fiscalYear") },
    { accessorKey: "periodNumber", header: t("accounting.period") },
    { accessorKey: "startDate", header: t("accounting.startDate"), cell: ({ row }) => row.original.startDate.slice(0, 10) },
    { accessorKey: "endDate", header: t("accounting.endDate"), cell: ({ row }) => row.original.endDate.slice(0, 10) },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => <Badge variant={row.original.status === "OPEN" ? "default" : row.original.status === "LOCKED" ? "destructive" : "secondary"}>{row.original.status}</Badge>,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <span className="flex gap-2">
          {row.original.status === "OPEN" && <Button size="sm" variant="outline" onClick={() => changeStatus.mutate({ id: row.original.id, status: "CLOSED" })}>{t("accounting.closePeriod")}</Button>}
          {row.original.status === "CLOSED" && (
            <>
              <Button size="sm" variant="outline" onClick={() => changeStatus.mutate({ id: row.original.id, status: "OPEN" })}>{t("accounting.reopenPeriod")}</Button>
              <Button size="sm" variant="outline" onClick={() => changeStatus.mutate({ id: row.original.id, status: "LOCKED" })}>{t("accounting.lockPeriod")}</Button>
            </>
          )}
          {(row.original._count?.journalEntries ?? 0) === 0 && (
            <Button size="sm" variant="destructive" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("accounting.fiscalPeriods")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>
        <Card>
          <CardHeader><CardTitle>{t("accounting.addPeriod")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label>{t("accounting.fiscalYear")}</Label><Input className="w-28" type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div>
              <div className="space-y-1">
                <Label>{t("accounting.period")}</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>{t("common.add")}</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <DataTable columns={columns} data={periods} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
