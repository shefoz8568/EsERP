"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, posApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { PosShift, PosTerminal, ZReport } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function PosShiftsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [terminalId, setTerminalId] = useState("");
  const [openingFloat, setOpeningFloat] = useState("50000");
  const [countedCash, setCountedCash] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState("");

  const query = useQuery({ queryKey: ["pos-shifts"], queryFn: () => posApi.listShifts({ pageSize: 100 }) });
  const terminals = useQuery({ queryKey: ["pos-terminals"], queryFn: () => posApi.listTerminals({ pageSize: 100 }) });
  const zReport = useQuery({
    queryKey: ["z-report", selectedShiftId],
    queryFn: () => posApi.zReport(selectedShiftId),
    enabled: !!selectedShiftId,
  });
  const rows = asList<PosShift>(query.data);
  const terminalList = asList<PosTerminal>(terminals.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pos-shifts"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const open = useMutation({
    mutationFn: () => posApi.openShift({ terminalId, openingFloatMinor: Number(openingFloat) }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });
  const close = useMutation({
    mutationFn: (id: string) => posApi.closeShift(id, { countedCashMinor: Number(countedCash) }),
    onSuccess: () => { toast.success(t("common.success")); setCountedCash(""); invalidate(); void zReport.refetch(); },
    onError,
  });

  const columns: ColumnDef<PosShift>[] = [
    { accessorKey: "terminal", header: t("pos.terminal"), cell: ({ row }) => row.original.terminal?.code ?? "—" },
    { accessorKey: "openedAt", header: t("pos.openShift"), cell: ({ row }) => row.original.openedAt.slice(0, 16).replace("T", " ") },
    { accessorKey: "closedAt", header: t("pos.closeShift"), cell: ({ row }) => row.original.closedAt?.slice(0, 16).replace("T", " ") ?? "—" },
    { accessorKey: "openingFloatMinor", header: t("pos.openingFloat"), cell: ({ row }) => formatMoney(row.original.openingFloatMinor, "SAR", locale) },
    { accessorKey: "varianceMinor", header: t("pos.variance"), cell: ({ row }) => formatMoney(row.original.varianceMinor, "SAR", locale) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "OPEN" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelectedShiftId(row.original.id)}>{t("pos.zReport")}</Button>
          {row.original.status === "OPEN" && (
            <>
              <Input type="number" min={0} className="w-32" placeholder={t("pos.countedCash")} value={selectedShiftId === row.original.id ? countedCash : ""} onChange={(e) => { setSelectedShiftId(row.original.id); setCountedCash(e.target.value); }} />
              <Button size="sm" disabled={countedCash === "" || selectedShiftId !== row.original.id} onClick={() => close.mutate(row.original.id)}>{t("pos.closeShift")}</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const z: ZReport | undefined = zReport.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("pos.shifts")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("pos.openShift")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>{t("pos.terminal")}</Label>
              <Select value={terminalId || "none"} onValueChange={(v) => setTerminalId(v === "none" ? "" : v)}>
                <SelectTrigger className="w-52"><SelectValue placeholder={t("pos.terminal")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {terminalList.map((x) => (<SelectItem key={x.id} value={x.id}>{x.code} — {x.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("pos.openingFloat")}</Label>
              <Input type="number" min={0} className="w-40" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
            </div>
            <Button disabled={!terminalId} onClick={() => open.mutate()}>{t("pos.openShift")}</Button>
          </CardContent>
        </Card>
        {z && (
          <Card>
            <CardHeader><CardTitle>{t("pos.zReport")} — {z.shift.terminal.code}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><div className="text-sm text-muted-foreground">{t("pos.salesCount")}</div><div className="text-lg font-bold">{z.salesCount}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("pos.gross")}</div><div className="text-lg font-bold">{formatMoney(z.grossMinor, "SAR", locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("sales.tax")}</div><div className="text-lg font-bold">{formatMoney(z.taxMinor, "SAR", locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("pos.total")}</div><div className="text-lg font-bold">{formatMoney(z.totalMinor, "SAR", locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("pos.cash")}</div><div className="text-lg font-bold">{formatMoney(z.cashMinor, "SAR", locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("pos.card")}</div><div className="text-lg font-bold">{formatMoney(z.cardMinor, "SAR", locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("pos.expectedCash")}</div><div className="text-lg font-bold">{formatMoney(z.expectedCashMinor, "SAR", locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("pos.variance")}</div><div className="text-lg font-bold">{z.varianceMinor !== null && z.varianceMinor !== undefined ? formatMoney(z.varianceMinor, "SAR", locale) : "—"}</div></div>
              </div>
            </CardContent>
          </Card>
        )}
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("pos.shifts")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
