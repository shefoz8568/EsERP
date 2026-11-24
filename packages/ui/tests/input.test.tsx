import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "../src/components/input";

describe("Input", () => {
  it("forwards value and onChange", () => {
    // Controlled input: the stub onChange never updates state, so React
    // resets the DOM value to "Riyadh" after the event. Capture the value
    // at call time instead of reading the (reset) live node afterwards.
    const seen: string[] = [];
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      seen.push(e.target.value);
    });
    render(<Input value="Riyadh" onChange={onChange} aria-label="City" />);
    const input = screen.getByLabelText("City") as HTMLInputElement;
    expect(input.value).toBe("Riyadh");

    fireEvent.change(input, { target: { value: "Jeddah" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Jeddah"]);
  });

  it("renders a placeholder and forwards the type attribute", () => {
    render(<Input placeholder="Search invoices" type="search" />);
    const input = screen.getByPlaceholderText("Search invoices") as HTMLInputElement;
    expect(input.type).toBe("search");
  });

  it("is disabled when the disabled prop is set", () => {
    render(<Input disabled placeholder="Disabled input" />);
    expect(screen.getByPlaceholderText("Disabled input")).toBeDisabled();
  });

  it("forwards a ref to the underlying input element", () => {
    const ref = vi.fn();
    render(<Input ref={ref} />);
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLInputElement));
  });
});
