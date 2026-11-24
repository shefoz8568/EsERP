import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../src/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../src/components/dialog";

function OpenDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open settings</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Company settings</DialogTitle>
        <DialogDescription>Update the company profile for this tenant.</DialogDescription>
        <p>Dialog body</p>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("is closed by default and opens when the trigger is clicked", async () => {
    render(<OpenDialog />);
    expect(screen.queryByText("Dialog body")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => expect(screen.getByText("Dialog body")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes when the close button is clicked", async () => {
    render(<OpenDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => expect(screen.getByText("Dialog body")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("Dialog body")).not.toBeInTheDocument());
  });

  it("closes when Escape is pressed", async () => {
    render(<OpenDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => expect(screen.getByText("Dialog body")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Dialog body")).not.toBeInTheDocument());
  });
});
