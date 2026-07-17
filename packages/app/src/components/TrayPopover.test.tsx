import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import TrayPopover from "./TrayPopover";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const USAGE = [
  {
    profile: "work",
    kind: "subscription",
    inputTokens: 100,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 50,
    totalTokens: 150,
    costUsd: 0,
    resetAt: null,
    active: true,
  },
];

describe("TrayPopover", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_usage") return Promise.resolve(USAGE);
      return Promise.resolve(undefined);
    });
  });

  it("lists profiles and opens a session", async () => {
    render(<TrayPopover />);
    await waitFor(() => screen.getByText(/work/));
    fireEvent.click(screen.getByLabelText("open work"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("open_session", { name: "work" }),
    );
  });

  it("opens the dashboard from the footer", async () => {
    render(<TrayPopover />);
    await waitFor(() => screen.getByText(/work/));
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("show_dashboard"));
  });
});
