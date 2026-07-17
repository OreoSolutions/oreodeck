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
});
