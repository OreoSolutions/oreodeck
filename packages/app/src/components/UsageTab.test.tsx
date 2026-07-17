import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import UsageTab from "./UsageTab";
import type { ProfileUsageView } from "../lib/api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const baseRow: ProfileUsageView = {
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
};

describe("UsageTab", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders '—' for a subscription profile's cost and a dollar amount for an api-key profile", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_usage")
        return Promise.resolve([
          { ...baseRow, profile: "work", kind: "subscription", costUsd: 0 },
          { ...baseRow, profile: "bot", kind: "api-key", costUsd: 1.2345 },
        ]);
      return Promise.resolve(undefined);
    });
    render(<UsageTab />);
    await screen.findByText("work");
    const workHead = screen.getByText("work").closest(".usage-head")!;
    const botHead = screen.getByText("bot").closest(".usage-head")!;
    expect(workHead.textContent).toContain("—");
    expect(botHead.textContent).toContain("$1.23");
  });

  it("shows '—' when resetAt is null and 'resetting' when resetAt is in the past", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_usage")
        return Promise.resolve([
          { ...baseRow, profile: "work", resetAt: null },
          { ...baseRow, profile: "bot", resetAt: Date.now() - 60_000 },
        ]);
      return Promise.resolve(undefined);
    });
    render(<UsageTab />);
    await screen.findByText("work");
    const workHead = screen.getByText("work").closest(".usage-head")!;
    const botHead = screen.getByText("bot").closest(".usage-head")!;
    expect(workHead.textContent).toContain("resets in —");
    expect(botHead.textContent).toContain("resets in resetting");
    expect(botHead.textContent).not.toMatch(/resets in -/);
  });

  it("polls get_usage every 30s and stops after unmount", async () => {
    vi.useFakeTimers();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_usage") return Promise.resolve([baseRow]);
      return Promise.resolve(undefined);
    });
    const { unmount } = render(<UsageTab />);
    await act(() => vi.advanceTimersByTimeAsync(0)); // flush the mount-time load()
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "get_usage").length).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "get_usage").length).toBe(2);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "get_usage").length).toBe(2);
  });
});
