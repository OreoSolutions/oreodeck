import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RemoveDialog from "./RemoveDialog";

describe("RemoveDialog", () => {
  it("enables Remove only when the typed name matches exactly", () => {
    const onConfirm = vi.fn();
    render(<RemoveDialog name="work" onConfirm={onConfirm} onCancel={() => {}} />);
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toBeDisabled();

    fireEvent.change(screen.getByLabelText("confirm name"), { target: { value: "wor" } });
    expect(remove).toBeDisabled();

    fireEvent.change(screen.getByLabelText("confirm name"), { target: { value: "work" } });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
