import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import FailoverTab from "./FailoverTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("FailoverTab", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_failover")
        return Promise.resolve({ enabled: true, order: ["work", "bot"] });
      return Promise.resolve(undefined);
    });
  });

  it("toggles failover and persists", async () => {
    render(<FailoverTab />);
    const toggle = await screen.findByLabelText("failover enabled");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_failover_enabled", { enabled: false }),
    );
  });

  it("reorders with the down button and persists canonical order", async () => {
    render(<FailoverTab />);
    await screen.findByText("work");
    fireEvent.click(screen.getByLabelText("move work down"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_failover_order", { order: ["bot", "work"] }),
    );
  });

  it("reverts to the backend order and surfaces an error when set_failover_order is rejected", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_failover")
        return Promise.resolve({ enabled: true, order: ["work", "bot"] });
      if (cmd === "set_failover_order") return Promise.reject(new Error("boom"));
      return Promise.resolve(undefined);
    });
    render(<FailoverTab />);
    await screen.findByText("work");
    fireEvent.click(screen.getByLabelText("move work down"));

    // Optimistic update briefly reorders...
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_failover_order", { order: ["bot", "work"] }),
    );
    // ...but the rejection triggers a reload that reverts to the backend's canonical order.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
    const names = screen.getAllByRole("listitem").map((li) => li.textContent?.split(/[↑↓]/)[0]);
    expect(names).toEqual(["work", "bot"]);
    // get_failover called once on mount + once on reconciliation after rejection.
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "get_failover").length).toBe(2);
  });
});
