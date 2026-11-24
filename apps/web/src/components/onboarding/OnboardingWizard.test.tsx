import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { en } from "@eserp/i18n";
import { OnboardingWizard } from "./OnboardingWizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function mockFetch() {
  const calls: Array<{ url: string; method: string }> = [];
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    const body = url.includes("/onboarding/step")
      ? { currentStep: 1, stepsCompleted: [0], completedAt: null, totalSteps: 7 }
      : { currentStep: 0, stepsCompleted: [], completedAt: null, totalSteps: 7 };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

function renderWizard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={en}>
        <OnboardingWizard locale="en" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("OnboardingWizard", () => {
  it("advances from the company step to the fiscal-year step (mock fetch)", async () => {
    const calls = mockFetch();
    renderWizard();

    await waitFor(() => expect(screen.getByText("Set up your company")).toBeInTheDocument());

    // Next is disabled until the company name is filled.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Company name"), {
      target: { value: "Al Safa Trading" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(screen.getByText("When does your financial year start?")).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.url.includes("/onboarding/step") && c.method === "POST")).toBe(true);
  });

  it("shows the Saudi chart-of-accounts template with the 5 groups and 15% VAT note", async () => {
    mockFetch();
    renderWizard();
    await waitFor(() => expect(screen.getByText("Set up your company")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Al Safa Trading" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(screen.getByText("When does your financial year start?")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(screen.getByText("Saudi Arabia template")).toBeInTheDocument(),
    );
    expect(screen.getByText(/5 account groups, 15% VAT/)).toBeInTheDocument();
    expect(screen.getByText(/Assets · Liabilities · Equity · Revenue · Expenses/)).toBeInTheDocument();
  });

  it("goes back to the previous step", async () => {
    mockFetch();
    renderWizard();
    await waitFor(() => expect(screen.getByText("Set up your company")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Al Safa Trading" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(screen.getByText("When does your financial year start?")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(screen.getByText("Tell us about your company")).toBeInTheDocument(),
    );
  });
});
