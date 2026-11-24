import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/en/dashboard",
}));

describe("LanguageSwitcher", () => {
  it("renders both locales: the other locale's label and the switcher control", () => {
    render(<LanguageSwitcher />);
    // On /en/dashboard the switcher offers Arabic.
    expect(screen.getByText("العربية")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch language/i })).toBeInTheDocument();
  });

  it("mentions both locale codes for screen readers", () => {
    render(<LanguageSwitcher />);
    expect(screen.getByText("en, ar")).toBeInTheDocument();
  });
});
