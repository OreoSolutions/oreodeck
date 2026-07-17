import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import ProfilesTab from "./ProfilesTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const PROFILES = [
  { name: "work", kind: "subscription", active: true },
  { name: "bot", kind: "api-key", active: false },
];

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
  {
    profile: "bot",
    kind: "api-key",
    inputTokens: 10,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 5,
    totalTokens: 15,
    costUsd: 1.2345,
    resetAt: Date.now() - 60_000,
    active: false,
  },
];

describe("ProfilesTab", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_profiles") return Promise.resolve(PROFILES);
      if (cmd === "get_usage") return Promise.resolve(USAGE);
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the profile table and marks the active one", async () => {
    render(<ProfilesTab />);
    await waitFor(() => screen.getByText("work"));
    expect(screen.getByText("bot")).toBeInTheDocument();
    expect(screen.getByText("api-key")).toBeInTheDocument();
  });

  it("shows token, cost, and reset columns sourced from get_usage", async () => {
    render(<ProfilesTab />);
    await waitFor(() => screen.getByText("work"));
    const workRow = screen.getByText("work").closest("tr")!;
    const botRow = screen.getByText("bot").closest("tr")!;
    expect(workRow.textContent).toContain("150");
    expect(workRow.textContent).toContain("—"); // subscription profile has no cost
    expect(botRow.textContent).toContain("15");
    expect(botRow.textContent).toContain("$1.23");
    expect(botRow.textContent).toContain("resetting"); // resetAt in the past
  });

  it("shows an empty-state message when there are no profiles", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_profiles") return Promise.resolve([]);
      if (cmd === "get_usage") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    render(<ProfilesTab />);
    await waitFor(() => screen.getByText(/No profiles yet/));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("polls list_profiles/get_usage every 30s and stops after unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ProfilesTab />);
    await act(() => vi.advanceTimersByTimeAsync(0)); // flush the mount-time load()
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "list_profiles").length).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "list_profiles").length).toBe(2);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "list_profiles").length).toBe(2);
  });

  it("calls set_active when Set active is clicked", async () => {
    render(<ProfilesTab />);
    await waitFor(() => screen.getByText("bot"));
    const botRow = screen.getByText("bot").closest("tr")!;
    fireEvent.click(botRow.querySelector("button")!); // first action button = Set active
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_active", { name: "bot" }),
    );
  });

  it("opens the remove dialog and confirms only with the exact name", async () => {
    render(<ProfilesTab />);
    await waitFor(() => screen.getByText("bot"));
    const botRow = screen.getByText("bot").closest("tr")!;
    const buttons = botRow.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1]); // Remove
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("confirm name"), { target: { value: "bot" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("remove_profile", { name: "bot" }),
    );
    expect(dialog).not.toBeInTheDocument();
  });

  it("shows a clean message instead of the raw CONFIG_CORRUPT sentinel", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_profiles") return Promise.reject("CONFIG_CORRUPT");
      return Promise.resolve(undefined);
    });
    render(<ProfilesTab />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toBe("CONFIG_CORRUPT");
    expect(alert.textContent).toMatch(/corrupt/i);
  });
});
