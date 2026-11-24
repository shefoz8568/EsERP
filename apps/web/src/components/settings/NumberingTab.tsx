"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button, Input, Label, toast } from "@eserp/ui";
import { asList, settingsApi } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { NumberingSeries } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

/** Live preview, e.g. INV-2026-00001. */
export function numberingPreview(prefix: string, nextNumber: number, padding = 5): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(nextNumber).padStart(padding, "0")}`;
}

const DOCUMENT_TYPES = ["INV", "QUOT", "PO", "SO", "PAY", "JV", "CN", "DN"];

export function NumberingTab() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = useState("INV");
  const [prefix, setPrefix] = useState("INV");
  const [nextNumber, setNextNumber] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["numbering-series"],
    queryFn: () => settingsApi.listNumberingSeries(),
  });
  const series = asList<NumberingSeries>(data);

  const preview = useMemo(() => numberingPreview(prefix, nextNumber), [prefix, nextNumber]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["numbering-series"] });

  const create = useMutation({
    mutationFn: () =>
      settingsApi.createNumberingSeries({
        code: documentType,
        name: documentType,
        pattern: `${prefix}-{YYYY}-${"0".repeat(5)}`,
        nextNumber,
        prefix,
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<NumberingSeries>[] = [
    { accessorKey: "code", header: t("settings.numbering.documentType") },
    { accessorKey: "nextNumber", header: t("settings.numbering.nextNumber") },
    {
      id: "preview",
      header: t("settings.numbering.preview"),
      cell: ({ row }) => (
        <code className="rounded bg-muted px-2 py-1 text-xs">
          {numberingPreview(row.original.prefix ?? row.original.code, row.original.nextNumber)}
        </code>
      ),
    },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <DataTable columns={columns} data={series} emptyMessage={t("common.noData")} />
      <form
        className="max-w-xl space-y-4 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3 className="font-medium">{t("settings.numbering.addSeries")}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="num-type">{t("settings.numbering.documentType")}</Label>
            <select
              id="num-type"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={documentType}
              onChange={(e) => {
                setDocumentType(e.target.value);
                setPrefix(e.target.value);
              }}
            >
              {DOCUMENT_TYPES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="num-prefix">{t("settings.numbering.prefix")}</Label>
            <Input id="num-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="num-next">{t("settings.numbering.nextNumber")}</Label>
            <Input id="num-next" type="number" min={1} value={nextNumber} onChange={(e) => setNextNumber(Number(e.target.value))} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings.numbering.preview")}:{" "}
          <code className="rounded bg-muted px-2 py-1 text-xs">{preview}</code>
        </p>
        <Button type="submit" disabled={create.isPending}>{t("common.add")}</Button>
      </form>
    </div>
  );
}
