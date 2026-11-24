"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { itemsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormPageHeader, FormSection, StickySaveBar } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";

type Snapshot = {
  name: string;
  sku: string;
  status: string;
  costingMethod: string;
  salesPrice: string;
  purchasePrice: string;
  reorderPoint: string;
  barcode: string;
};

export default function ItemDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["items", id], queryFn: () => itemsApi.get(id) });
  const item = query.data;

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [costingMethod, setCostingMethod] = useState("FIFO");
  const [salesPrice, setSalesPrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [initial, setInitial] = useState<Snapshot | null>(null);
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    if (item && !initial) {
      const snap: Snapshot = {
        name: item.name,
        sku: item.sku,
        status: item.status,
        costingMethod: item.costingMethod,
        salesPrice: String(item.salesPriceMinor / 100),
        purchasePrice: String(item.purchasePriceMinor / 100),
        reorderPoint: String(item.reorderPoint),
        barcode: item.barcode ?? "",
      };
      setInitial(snap);
      setName(snap.name);
      setSku(snap.sku);
      setStatus(snap.status);
      setCostingMethod(snap.costingMethod);
      setSalesPrice(snap.salesPrice);
      setPurchasePrice(snap.purchasePrice);
      setReorderPoint(snap.reorderPoint);
      setBarcode(snap.barcode);
    }
  }, [item, initial]);

  const current: Snapshot = { name, sku, status, costingMethod, salesPrice, purchasePrice, reorderPoint, barcode };
  const dirty = initial !== null && JSON.stringify(current) !== JSON.stringify(initial);
  const valid =
    !!name.trim() &&
    !!sku.trim() &&
    Number(salesPrice || 0) >= 0 &&
    Number(purchasePrice || 0) >= 0 &&
    Number(reorderPoint || 0) >= 0;

  const discard = () => {
    if (!initial) return;
    setName(initial.name);
    setSku(initial.sku);
    setStatus(initial.status);
    setCostingMethod(initial.costingMethod);
    setSalesPrice(initial.salesPrice);
    setPurchasePrice(initial.purchasePrice);
    setReorderPoint(initial.reorderPoint);
    setBarcode(initial.barcode);
    setTriedSave(false);
  };

  const save = useMutation({
    mutationFn: () =>
      itemsApi.update(id, {
        name, sku, status: status as never, costingMethod: costingMethod as never,
        salesPriceMinor: Math.round(Number(salesPrice || 0) * 100),
        purchasePriceMinor: Math.round(Number(purchasePrice || 0) * 100),
        reorderPoint: Number(reorderPoint) || 0,
        barcode: barcode || undefined,
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setInitial(current);
      setTriedSave(false);
      void queryClient.invalidateQueries({ queryKey: ["items", id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const remove = useMutation({
    mutationFn: () => itemsApi.delete(id),
    onSuccess: () => { toast.success(t("common.success")); router.push(`/${locale}/items`); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <FormPageHeader
          title={item?.name ?? t("common.loading")}
          subtitle={item ? `${t("masterData.sku")}: ${item.sku}` : undefined}
          status={item ? <StatusBadge status={item.status} /> : undefined}
          onBack={() => router.push(`/${locale}/items`)}
          backLabel={t("common.back")}
          actions={
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t("common.delete")}
            </Button>
          }
        />
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : !item ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <FormSection id="item-details" title={t("common.edit")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("masterData.sku")} required error={triedSave && !sku.trim() ? t("common.required") : undefined}>
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} />
                </FormField>
                <FormField label={t("common.name")} required error={triedSave && !name.trim() ? t("common.required") : undefined}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </FormField>
                <FormField label={t("common.status")}>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">{t("common.active")}</SelectItem>
                      <SelectItem value="INACTIVE">{t("common.inactive")}</SelectItem>
                      <SelectItem value="DISCONTINUED">{t("masterData.discontinued")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("masterData.costingMethod")}>
                  <Select value={costingMethod} onValueChange={setCostingMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIFO">FIFO</SelectItem>
                      <SelectItem value="WEIGHTED_AVERAGE">WEIGHTED_AVERAGE</SelectItem>
                      <SelectItem value="STANDARD">STANDARD</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </FormSection>

            <FormSection id="item-pricing" title={`${t("masterData.salesPrice")} / ${t("masterData.purchasePrice")}`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label={`${t("masterData.salesPrice")} (SAR)`}
                  error={triedSave && Number(salesPrice || 0) < 0 ? t("common.error") : undefined}
                >
                  <Input type="number" min="0" step="0.01" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} />
                </FormField>
                <FormField
                  label={`${t("masterData.purchasePrice")} (SAR)`}
                  error={triedSave && Number(purchasePrice || 0) < 0 ? t("common.error") : undefined}
                >
                  <Input type="number" min="0" step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.barcode")}>
                  <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.reorderPoint")}>
                  <Input type="number" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
                </FormField>
              </div>
            </FormSection>

            <StickySaveBar
              dirty={dirty}
              saving={save.isPending}
              saveDisabled={!valid}
              onSave={() => {
                setTriedSave(true);
                if (valid) save.mutate();
              }}
              onDiscard={discard}
              saveLabel={t("common.save")}
              discardLabel={t("common.discard")}
              unsavedLabel={t("common.unsavedChanges")}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
