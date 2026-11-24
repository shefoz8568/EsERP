"use client";

import { use } from "react";
import { AppShell } from "@/components/AppShell";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  return (
    <AppShell locale={locale}>
      <OnboardingWizard locale={locale} />
    </AppShell>
  );
}
