"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, posApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { PosSale, PosShift, PosTerminal } from "@/lib/types";

interface CartLine {
  itemId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  taxRateBps: number;
}

export default function PosPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [terminalId, setTerminalId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [lastSale, setLastSale] = useState<PosSale | null>(null);

  const terminals = useQuery({ queryKey: ["pos-terminals"], queryFn: () => posApi.listTerminals({ pageSize: 100 }) });
  const shifts = useQuery({
    queryKey: ["pos-shifts-open", terminalId],
    queryFn: () => posApi.listShifts({ terminalId: terminalId || undefined, status: "OPEN", pageSize: 10 }),
    enabled: !!terminalId,
  });
  const terminalList = asList<PosTerminal>(terminals.data);
  const openShifts = asList<PosShift>(shifts.data);
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const lookup = useMutation({
    mutationFn: () => posApi.lookup(terminalId, lookupCode.trim()),
    onSuccess: (res) => {
      if (res.qtyAvailable <= 0) {
        toast.error(t("inventory.lowStock"));
        return;
      }
      setCart((prev) => {
        const existing = prev.find((l) => l.itemId === res.item.id);
        if (existing) {
          return prev.map((l) => (l.itemId === res.item.id ? { ...l, quantity: l.quantity + 1 } : l));
        }
        return [...prev, { itemId: res.item.id, sku: res.item.sku, name: res.item.name, quantity: 1, unitPriceMinor: res.priceMinor, taxRateBps: res.taxRateBps }];
      });
      setLookupCode("");
    },
    onError,
  });

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
  const tax = cart.reduce((s, l) => s + Math.round((l.quantity * l.unitPriceMinor * l.taxRateBps) / 10000), 0);
  const total = subtotal + tax;

  const sale = useMutation({
    mutationFn: () =>
      posApi.createSale({
        terminalId,
        shiftId,
        lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBps: l.taxRateBps })),
        payments: [
          ...(Number(cash) > 0 ? [{ method: "CASH", amountMinor: Number(cash) }] : []),
          ...(Number(card) > 0 ? [{ method: "CARD", amountMinor: Number(card) }] : []),
        ],
      }),
    onSuccess: (res) => {
      toast.success(t("common.success"));
      setLastSale(res);
      setCart([]);
      setCash("");
      setCard("");
      void queryClient.invalidateQueries({ queryKey: ["pos-shifts-open"] });
    },
    onError,
  });
  const voidSale = useMutation({
    mutationFn: (id: string) => posApi.voidSale(id),
    onSuccess: () => { toast.success(t("common.success")); setLastSale(null); },
    onError,
  });

  const paymentsOk = Number(cash || 0) + Number(card || 0) === total && total > 0;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("pos.pos")}</h1>
        {terminals.isError ? (
          <ErrorState onRetry={() => void terminals.refetch()} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{t("pos.newSale")}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{t("pos.terminal")}</Label>
                    <Select value={terminalId || "none"} onValueChange={(v) => { setTerminalId(v === "none" ? "" : v); setShiftId(""); }}>
                      <SelectTrigger><SelectValue placeholder={t("pos.terminal")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {terminalList.map((x) => (<SelectItem key={x.id} value={x.id}>{x.code} — {x.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("pos.shifts")}</Label>
                    <Select value={shiftId || "none"} onValueChange={(v) => setShiftId(v === "none" ? "" : v)} disabled={!terminalId || openShifts.length === 0}>
                      <SelectTrigger><SelectValue placeholder={openShifts.length === 0 ? t("pos.openShift") : t("pos.shifts")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {openShifts.map((s) => (<SelectItem key={s.id} value={s.id}>{s.openedAt.slice(0, 16).replace("T", " ")} — {formatMoney(s.openingFloatMinor, "SAR", locale)}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("pos.lookup")}
                    value={lookupCode}
                    onChange={(e) => setLookupCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && lookupCode.trim() && terminalId) lookup.mutate(); }}
                    disabled={!terminalId}
                  />
                  <Button disabled={!terminalId || !lookupCode.trim()} onClick={() => lookup.mutate()}>{t("pos.addItem")}</Button>
                </div>
                {cart.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
                ) : (
                  <div className="space-y-2">
                    {cart.map((l) => (
                      <div key={l.itemId} className="flex items-center gap-3 text-sm">
                        <span className="w-48">{l.sku} — {l.name}</span>
                        <Input
                          type="number" min={1} className="w-20" value={l.quantity}
                          onChange={(e) => setCart(cart.map((x) => (x.itemId === l.itemId ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))}
                        />
                        <span>@ {formatMoney(l.unitPriceMinor, "SAR", locale)}</span>
                        <span className="font-medium">{formatMoney(l.quantity * l.unitPriceMinor, "SAR", locale)}</span>
                        <Button size="sm" variant="outline" onClick={() => setCart(cart.filter((x) => x.itemId !== l.itemId))}>{t("common.delete")}</Button>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-2 text-sm">
                      <span>{t("pos.net")}</span><span>{formatMoney(subtotal, "SAR", locale)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>{t("sales.tax")}</span><span>{formatMoney(tax, "SAR", locale)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold">
                      <span>{t("pos.total")}</span><span>{formatMoney(total, "SAR", locale)}</span>
                    </div>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{t("pos.cash")}</Label>
                    <Input type="number" min={0} value={cash} onChange={(e) => setCash(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("pos.card")}</Label>
                    <Input type="number" min={0} value={card} onChange={(e) => setCard(e.target.value)} />
                  </div>
                </div>
                <Button disabled={!terminalId || !shiftId || cart.length === 0 || !paymentsOk} onClick={() => sale.mutate()}>
                  {t("pos.newSale")} — {formatMoney(total, "SAR", locale)}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("pos.receipt")}</CardTitle></CardHeader>
              <CardContent>
                {!lastSale ? (
                  <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>{t("accounting.number")}</span><span className="font-bold">{lastSale.number}</span></div>
                    <div className="flex justify-between"><span>{t("common.status")}</span><Badge variant={lastSale.status === "COMPLETED" ? "default" : "destructive"}>{lastSale.status}</Badge></div>
                    {lastSale.lines.map((l) => (
                      <div key={l.id} className="flex justify-between">
                        <span>{l.item?.sku} × {l.quantity}</span>
                        <span>{formatMoney(l.lineTotalMinor, "SAR", locale)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-2"><span>{t("sales.tax")}</span><span>{formatMoney(lastSale.taxMinor, "SAR", locale)}</span></div>
                    <div className="flex justify-between font-bold"><span>{t("pos.total")}</span><span>{formatMoney(lastSale.totalMinor, "SAR", locale)}</span></div>
                    <div className="flex justify-between"><span>{t("pos.cash")}</span><span>{formatMoney(lastSale.cashMinor, "SAR", locale)}</span></div>
                    <div className="flex justify-between"><span>{t("pos.card")}</span><span>{formatMoney(lastSale.cardMinor, "SAR", locale)}</span></div>
                    {lastSale.status === "COMPLETED" && (
                      <Button size="sm" variant="outline" onClick={() => voidSale.mutate(lastSale.id)}>{t("pos.void")}</Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
