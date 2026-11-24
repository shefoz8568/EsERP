import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../src/components/badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders each variant with its distinguishing class", () => {
    const { rerender } = render(<Badge variant="default">Default</Badge>);
    expect(screen.getByText("Default")).toHaveClass("bg-primary");

    rerender(<Badge variant="secondary">Secondary</Badge>);
    expect(screen.getByText("Secondary")).toHaveClass("bg-secondary");

    rerender(<Badge variant="destructive">Overdue</Badge>);
    expect(screen.getByText("Overdue")).toHaveClass("bg-destructive");

    rerender(<Badge variant="outline">Draft</Badge>);
    expect(screen.getByText("Draft")).toHaveClass("text-foreground");

    rerender(<Badge variant="success">Paid</Badge>);
    expect(screen.getByText("Paid")).toHaveClass("bg-emerald-600");

    rerender(<Badge variant="warning">Pending</Badge>);
    expect(screen.getByText("Pending")).toHaveClass("bg-amber-500");
  });

  it("accepts extra class names", () => {
    render(<Badge className="uppercase">Upper</Badge>);
    expect(screen.getByText("Upper")).toHaveClass("uppercase");
  });
});
