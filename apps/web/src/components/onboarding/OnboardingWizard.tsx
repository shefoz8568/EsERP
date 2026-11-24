"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import Papa from "papaparse";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, Upload } from "lucide-react";
import { Button, Input, Label } from "@eserp/ui";
import { ApiError, onboardingApi } from "@/lib/api";
import { ROLES } from "@/lib/permissions";
import { isOnboardingComplete } from "@/lib/types";
import { ErrorState } from "@/components/ErrorState";

/** Saudi chart of accounts template summary (5 groups, 15% VAT). */
const SAUDI_COA_GROUPS = [
  { en: "Assets", ar: "الأصول" },
  { en: "Liabilities", ar: "الالتزامات" },
  { en: "Equity", ar: "حقوق الملكية" },
  { en: "Revenue", ar: "الإيرادات" },
  { en: "Expenses", ar: "المصروفات" },
] as const;

const STEP_KEYS = [
  "company",
  "fiscalYear",
  "chartOfAccounts",
  "taxes",
  "warehouse",
  "inviteUsers",
  "importData",
] as const;

interface CsvRowIssue {
  row: number;
  message: string;
}

function validateCsvRows(rows: string[][]): { valid: string[][]; issues: CsvRowIssue[] } {
  const valid: string[][] = [];
  const issues: CsvRowIssue[] = [];
  if (rows.length === 0) return { valid, issues };
  const header = rows[0];
  const emailIdx = header.findIndex((h) => h.trim().toLowerCase().includes("email"));
  rows.slice(1).forEach((row, i) => {
    const lineNo = i + 2;
    if (row.length < header.length) {
      issues.push({ row: lineNo, message: `Expected ${header.length} columns, got ${row.length}` });
      return;
    }
    if (!row[0]?.trim()) {
      issues.push({ row: lineNo, message: "First column must not be empty" });
      return;
    }
    if (emailIdx >= 0 && row[emailIdx] && !/^\S+@\S+\.\S+$/.test(row[emailIdx].trim())) {
      issues.push({ row: lineNo, message: "Invalid email address" });
      return;
    }
    valid.push(row);
  });
  return { valid, issues };
}

export function OnboardingWizard({ locale }: { locale: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 0 — company (real step-0 DTO is companyProfileDto: legalName/tradeName.
  // Workspace name + default currency were set at registration.)
  const [companyName, setCompanyName] = useState("");
  // Step 1 — fiscal year (real DTO: { fiscalYearStartMonth: 1-12, calendarType })
  const [fiscalYearStart, setFiscalYearStart] = useState("2026-01-01");
  const [calendarType, setCalendarType] = useState<"gregorian" | "hijri">("gregorian");
  // Step 2 — chart of accounts (Saudi template pre-selected)
  const [coaTemplate, setCoaTemplate] = useState("saudi");
  // Step 3 — taxes
  const [taxName, setTaxName] = useState("VAT");
  const [taxRate, setTaxRate] = useState(15);
  const [taxInclusive, setTaxInclusive] = useState(false);
  // Step 4 — warehouse
  const [warehouseName, setWarehouseName] = useState("");
  const [warehouseCity, setWarehouseCity] = useState("");
  // Step 5 — invites
  const [invites, setInvites] = useState<Array<{ email: string; role: string }>>([
    { email: "", role: "VIEWER" },
  ]);
  // Step 6 — CSV import (real DTO: { csvText }; validated server-side too)
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvIssues, setCsvIssues] = useState<CsvRowIssue[]>([]);
  const [csvValid, setCsvValid] = useState<string[][]>([]);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const resume = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => onboardingApi.get(),
  });

  // Resume where the user left off (server tracks currentStep).
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (!resumed && resume.data && !isOnboardingComplete(resume.data)) {
      setStep(Math.min(resume.data.currentStep, STEP_KEYS.length - 1));
      setResumed(true);
    }
  }, [resume.data, resumed]);

  const saveStep = useMutation({
    mutationFn: ({ step: s, data }: { step: number; data: Record<string, unknown> }) =>
      onboardingApi.step(s, data),
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("common.error"));
    },
  });

  const complete = useMutation({
    mutationFn: () => onboardingApi.complete(),
    onSuccess: () => setDone(true),
    onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
  });

  const stepData = (s: number): Record<string, unknown> => {
    switch (s) {
      case 0:
        // Step-0 DTO is companyProfileDto.
        return { legalName: companyName, tradeName: companyName };
      case 1: {
        // Step-1 DTO wants the start MONTH (1-12), not a date.
        const month = Number(fiscalYearStart.split("-")[1] ?? 1);
        return { fiscalYearStartMonth: month, calendarType };
      }
      case 2:
        return { template: coaTemplate };
      case 3:
        // Step-3 DTO: { taxes: [{ name, rateBps, type, isInclusive, isDefault }] }.
        return {
          taxes: [
            {
              name: taxName,
              rateBps: Math.round(taxRate * 100),
              type: "standard",
              isInclusive: taxInclusive,
              isDefault: true,
            },
          ],
        };
      case 4:
        return { name: warehouseName, city: warehouseCity };
      case 5:
        // Invite DTO: { email, roleNames: string[] }.
        return {
          invites: invites
            .filter((i) => i.email.trim())
            .map((i) => ({ email: i.email.trim(), roleNames: [i.role] })),
        };
      case 6:
        // Step-6 DTO: { csvText } (raw CSV; server validates in preview).
        return { csvText };
      default:
        return {};
    }
  };

  const stepValid = (s: number): boolean => {
    switch (s) {
      case 0:
        return companyName.trim().length >= 2;
      case 1:
        return fiscalYearStart.length > 0;
      case 3:
        return taxName.trim().length > 0 && taxRate >= 0 && taxRate <= 100;
      case 4:
        return warehouseName.trim().length >= 2;
      default:
        return true;
    }
  };

  const goNext = async () => {
    setError(null);
    try {
      await saveStep.mutateAsync({ step, data: stepData(step) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Contract says the endpoint exists; surface the error, never invent data.
        setError(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : t("common.error"));
      return;
    }
    if (step < STEP_KEYS.length - 1) setStep(step + 1);
    else complete.mutate();
  };

  const skipStep = () => {
    // Skipping the last step means finishing (complete only needs steps 0-4).
    if (step === STEP_KEYS.length - 1) {
      complete.mutate();
      return;
    }
    setStep(step + 1);
  };

  const handleCsvFile = async (file: File) => {
    setCsvFileName(file.name);
    const text = await file.text();
    setCsvText(text);
    // Instant local preview with PapaParse (in the browser).
    Papa.parse<string[]>(text, {
      complete: (results) => {
        const rows = (results.data as string[][]).filter((r) => r.some((c) => c?.trim()));
        setCsvRows(rows);
        const { valid, issues } = validateCsvRows(rows);
        setCsvValid(valid);
        setCsvIssues(issues);
      },
      error: (err: Error) => setError(err.message),
      skipEmptyLines: true,
    });
    // Server-side validation via POST /onboarding/import/preview.
    try {
      const preview = await onboardingApi.importPreview(text);
      setCsvIssues(preview.errors);
      setCsvValid(preview.preview.map((row) => Object.values(row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    }
  };

  const progress = Math.round(((step + (done ? 1 : 0)) / STEP_KEYS.length) * 100);
  const canSkip = step === 5 || step === 6;

  if (resume.isError) return <ErrorState onRetry={() => void resume.refetch()} />;
  if (resume.isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isOnboardingComplete(resume.data) && !done) {
    // Already completed in a previous session — offer the dashboard.
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-bold">{t("onboarding.completeTitle")}</h2>
        <Link href={`/${locale}/dashboard`}>
          <Button>{t("onboarding.goToDashboard")}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("onboarding.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
      </div>

      {/* Progress bar + step labels */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t(`onboarding.steps.${STEP_KEYS[step]}` as never)} · {step + 1} / {STEP_KEYS.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <ol className="mt-3 flex flex-wrap gap-2">
          {STEP_KEYS.map((key, i) => (
            <li
              key={key}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step && <Check className="h-3 w-3" />}
              {t(`onboarding.steps.${key}` as never)}
            </li>
          ))}
        </ol>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {done ? (
        <div className="space-y-4 rounded-lg border bg-card p-6 text-center">
          <h2 className="text-xl font-bold">{t("onboarding.completeTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("onboarding.completeSubtitle")}</p>
          <Button onClick={() => router.push(`/${locale}/dashboard`)}>
            {t("onboarding.goToDashboard")}
          </Button>
        </div>
      ) : (
        <div className="space-y-5 rounded-lg border bg-card p-6">
          {step === 0 && (
            <>
              <p className="text-sm text-muted-foreground">{t("onboarding.companySubtitle")}</p>
              <div className="space-y-2">
                <Label htmlFor="companyName">{t("onboarding.companyName")}</Label>
                <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm text-muted-foreground">{t("onboarding.fiscalYearSubtitle")}</p>
              <div className="space-y-2">
                <Label htmlFor="fiscalYearStart">{t("onboarding.fiscalYearStart")}</Label>
                <Input
                  id="fiscalYearStart"
                  type="date"
                  value={fiscalYearStart}
                  onChange={(e) => setFiscalYearStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="calendarType">{t("onboarding.calendarType")}</Label>
                <select
                  id="calendarType"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={calendarType}
                  onChange={(e) => setCalendarType(e.target.value as "gregorian" | "hijri")}
                >
                  <option value="gregorian">{t("onboarding.calendarGregorian")}</option>
                  <option value="hijri">{t("onboarding.calendarHijri")}</option>
                </select>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">{t("onboarding.chartOfAccountsSubtitle")}</p>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-primary bg-primary/5 p-4">
                <input
                  type="radio"
                  name="coa"
                  value="saudi"
                  checked={coaTemplate === "saudi"}
                  onChange={() => setCoaTemplate("saudi")}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{t("onboarding.saudiTemplate")}</span>
                  <span className="block text-sm text-muted-foreground">{t("onboarding.saudiTemplateNote")}</span>
                  <span className="mt-2 block text-sm">
                    {t("onboarding.accountGroups")}:{" "}
                    {SAUDI_COA_GROUPS.map((g) => (locale === "ar" ? g.ar : g.en)).join(" · ")}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t("onboarding.vatNote")}</span>
                </span>
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">{t("onboarding.taxesSubtitle")}</p>
              <div className="space-y-2">
                <Label htmlFor="taxName">{t("settings.tax.name")}</Label>
                <Input id="taxName" value={taxName} onChange={(e) => setTaxName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxRate">{t("onboarding.taxRate")}</Label>
                <Input
                  id="taxRate"
                  type="number"
                  min={0}
                  max={100}
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">{t("onboarding.vatNote")}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("settings.tax.type")}</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="taxType" checked={!taxInclusive} onChange={() => setTaxInclusive(false)} />
                    {t("onboarding.taxExclusive")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="taxType" checked={taxInclusive} onChange={() => setTaxInclusive(true)} />
                    {t("onboarding.taxInclusive")}
                  </label>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className="text-sm text-muted-foreground">{t("onboarding.warehouseSubtitle")}</p>
              <div className="space-y-2">
                <Label htmlFor="warehouseName">{t("onboarding.warehouseName")}</Label>
                <Input id="warehouseName" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warehouseCity">{t("onboarding.warehouseCity")}</Label>
                <Input id="warehouseCity" value={warehouseCity} onChange={(e) => setWarehouseCity(e.target.value)} />
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className="text-sm text-muted-foreground">{t("onboarding.inviteUsersSubtitle")}</p>
              <div className="space-y-3">
                {invites.map((invite, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label>{t("onboarding.inviteEmail")}</Label>
                      <Input
                        type="email"
                        value={invite.email}
                        onChange={(e) =>
                          setInvites(invites.map((v, j) => (j === i ? { ...v, email: e.target.value } : v)))
                        }
                      />
                    </div>
                    <div className="w-36 space-y-1">
                      <Label>{t("onboarding.inviteRole")}</Label>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                        value={invite.role}
                        onChange={(e) =>
                          setInvites(invites.map((v, j) => (j === i ? { ...v, role: e.target.value } : v)))
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setInvites(invites.filter((_, j) => j !== i))}
                      disabled={invites.length === 1}
                      aria-label="Remove invite"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setInvites([...invites, { email: "", role: "VIEWER" }])}>
                  <Plus className="h-4 w-4" />
                  <span className="ms-1">{t("onboarding.addInvite")}</span>
                </Button>
              </div>
            </>
          )}

          {step === 6 && (
            <>
              <p className="text-sm text-muted-foreground">{t("onboarding.importDataSubtitle")}</p>
              <div className="space-y-2">
                <Label>{t("onboarding.csvUpload")}</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCsvFile(f);
                  }}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  <span className="ms-1">{csvFileName || t("onboarding.csvChooseFile")}</span>
                </Button>
                {!csvFileName && <p className="text-xs text-muted-foreground">{t("onboarding.csvNoFile")}</p>}
              </div>
              {csvRows.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm">
                    {t("onboarding.csvTotalRows")}: {csvRows.length - 1} · {t("onboarding.csvValidRows")}:{" "}
                    {csvValid.length} · {t("onboarding.csvErrors")}: {csvIssues.length}
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-start">
                          {csvRows[0].map((h, i) => (
                            <th key={i} className="px-3 py-2 text-start font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(1, 11).map((row, i) => (
                          <tr key={i} className="border-b last:border-0">
                            {row.map((cell, j) => (
                              <td key={j} className="px-3 py-2">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csvIssues.length > 0 && (
                    <div className="rounded-md bg-destructive/10 p-3">
                      <p className="mb-1 text-sm font-medium">{t("onboarding.csvErrors")}</p>
                      <ul className="space-y-1 text-sm">
                        {csvIssues.map((issue) => (
                          <li key={issue.row}>
                            {t("onboarding.csvRow")} {issue.row}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" disabled={step === 0 || saveStep.isPending} onClick={() => setStep(step - 1)}>
              {t("common.back")}
            </Button>
            <div className="flex items-center gap-2">
              {canSkip && (
                <Button variant="ghost" onClick={skipStep}>
                  {t("onboarding.skip")}
                </Button>
              )}
              <Button disabled={!stepValid(step) || saveStep.isPending || complete.isPending} onClick={() => void goNext()}>
                {step === STEP_KEYS.length - 1 ? t("common.finish") : t("common.next")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
