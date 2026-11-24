"use client";

import { useTranslations } from "next-intl";
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eserp/ui";
import type { Item } from "@/lib/types";

export interface DocLineDraft {
  itemId: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRatePct: string;
}

export const emptyDocLine = (): DocLineDraft => ({
  itemId: "",
  quantity: "1",
  unitPrice: "",
  discountPct: "0",
  taxRatePct: "15",
});

/** Line total preview in major units (qty x price, minus discount, plus VAT). */
export function docLineTotalMajor(line: DocLineDraft): number {
  const qty = Number(line.quantity || 0);
  const price = Number(line.unitPrice || 0);
  const gross = qty * price;
  const net = gross * (1 - Number(line.discountPct || 0) / 100);
  return net * (1 + Number(line.taxRatePct || 0) / 100);
}

/**
 * Editable document lines (quote / order / invoice / PO): item, quantity,
 * unit price (major units), discount %, VAT %. The caller converts major
 * units to minor units (x100) on submit.
 */
export function DocLinesEditor({
  items,
  lines,
  onChange,
}: {
  items: Item[];
  lines: DocLineDraft[];
  onChange: (lines: DocLineDraft[]) => void;
}) {
  const t = useTranslations();
  const setLine = (i: number, patch: Partial<DocLineDraft>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + docLineTotalMajor(l), 0);

  return (
    <div className="space-y-3">
      {lines.map((line, i) => (
        <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("sales.item")}</Label>
            <Select value={line.itemId || "none"} onValueChange={(v) => setLine(i, { itemId: v === "none" ? "" : v, unitPrice: v === "none" ? line.unitPrice : String(((items.find((it) => it.id === v)?.salesPriceMinor ?? 0) / 100)) })}>
              <SelectTrigger><SelectValue placeholder={t("sales.item")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>{it.sku} — {it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>{t("sales.quantity")}</Label><Input type="number" min="1" step="1" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
          <div className="space-y-1"><Label>{t("sales.unitPrice")}</Label><Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></div>
          <div className="space-y-1"><Label>{t("sales.discount")}</Label><Input type="number" min="0" max="100" step="1" value={line.discountPct} onChange={(e) => setLine(i, { discountPct: e.target.value })} /></div>
          <div className="space-y-1"><Label>{t("sales.taxRate")}</Label><Input type="number" min="0" max="100" step="1" value={line.taxRatePct} onChange={(e) => setLine(i, { taxRatePct: e.target.value })} /></div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => onChange([...lines, emptyDocLine()])}>{t("sales.addLine")}</Button>
        {lines.length > 1 && (
          <Button variant="outline" size="sm" onClick={() => onChange(lines.slice(0, -1))}>{t("common.delete")}</Button>
        )}
        <span className="text-sm text-muted-foreground">{t("sales.total")}: {total.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** Convert draft lines to API input (minor units). */
export function toApiLines(lines: DocLineDraft[]) {
  return lines.map((l) => ({
    itemId: l.itemId,
    quantity: Math.max(1, Math.round(Number(l.quantity || 1))),
    unitPriceMinor: Math.round(Number(l.unitPrice || 0) * 100),
    discountPct: Math.min(100, Math.max(0, Math.round(Number(l.discountPct || 0)))),
    taxRateBps: Math.min(10000, Math.max(0, Math.round(Number(l.taxRatePct || 0) * 100))),
  }));
}
