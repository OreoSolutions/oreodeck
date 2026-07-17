import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import TrayPopover from "./TrayPopover";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockListen = listen as unknown as ReturnType<typeof vi.fn>;

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

// Captures the handler TrayPopover registers for lib.rs's "popover-visible" event so
// tests can simulate the tray window being shown/hidden without a real Tauri runtime.
let visibilityHandler: (event: { payload: boolean }) => void;
const mockUnlisten = vi.fn();

function showPopover() {
  return act(async () => {
    visibilityHandler({ payload: true });
    await Promise.resolve();
  });
}

const usageCallCount = () => mockInvoke.mock.calls.filter(([cmd]) => cmd === "get_usage").length;

describe("TrayPopover", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_usage") return Promise.resolve(USAGE);
      return Promise.resolve(undefined);
    });
    mockUnlisten.mockReset();
    mockListen.mockReset();
    mockListen.mockImplementation((_event: string, handler: (e: { payload: boolean }) => void) => {
      visibilityHandler = handler;
      return Promise.resolve(mockUnlisten);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists profiles and opens a session once the popover becomes visible", async () => {
    render(<TrayPopover />);
    await showPopover();
    await waitFor(() => screen.getByText(/work/));
    fireEvent.click(screen.getByLabelText("open work"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("open_session", { name: "work" }),
    );
  });

  it("opens the dashboard from the footer", async () => {
    render(<TrayPopover />);
    await showPopover();
    await waitFor(() => screen.getByText(/work/));
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("show_dashboard"));
  });

  it("quits via the footer button", async () => {
    render(<TrayPopover />);
    await showPopover();
    await waitFor(() => screen.getByText(/work/));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("quit_app"));
  });

  it("gates polling on the popover-visible event: no polling while hidden, immediate load + interval while shown, no stacked interval on repeat toggles", async () => {
    vi.useFakeTimers();
    render(<TrayPopover />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(usageCallCount()).toBe(0); // hidden at mount — no polling

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(usageCallCount()).toBe(0); // still hidden — nothing fires

    await act(async () => {
      visibilityHandler({ payload: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(usageCallCount()).toBe(1); // immediate load on becoming visible

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(usageCallCount()).toBe(2); // interval resumes

    await act(async () => {
      visibilityHandler({ payload: false });
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(usageCallCount()).toBe(2); // hidden again — polling stops, no interval survives

    await act(async () => {
      visibilityHandler({ payload: true }); // shown again
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(usageCallCount()).toBe(3);

    await act(async () => {
      visibilityHandler({ payload: true }); // repeat "shown" while already shown
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(usageCallCount()).toBe(3); // no extra immediate load — already polling

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(usageCallCount()).toBe(4); // exactly one interval firing, not stacked
  });

  it("shows an empty-state message when there are no profiles", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_usage") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    render(<TrayPopover />);
    await showPopover();
    await screen.findByText(/No profiles yet/);
  });

  it("shows a compact error banner and does not crash when get_usage rejects with CONFIG_CORRUPT", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_usage") return Promise.reject("CONFIG_CORRUPT");
      return Promise.resolve(undefined);
    });
    render(<TrayPopover />);
    await showPopover();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/corrupt/i);
    fireEvent.click(screen.getByRole("button", { name: "Open config file" }));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("open_config_in_editor"));
  });
});
