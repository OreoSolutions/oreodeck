import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import AddSubscriptionForm from "./AddSubscriptionForm";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("AddSubscriptionForm", () => {
  beforeEach(() => mockInvoke.mockReset());

  // Pins C1: window.prompt never returns a value in the packaged app (WKWebView has no
  // text-input delegate wired up), so this must be an in-app form that actually reaches
  // open_login_terminal, and the poll that follows must resolve.
  it("opens the login terminal with the typed name and calls onAdded once the poll finds the profile", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "open_login_terminal") return Promise.resolve(undefined);
      if (cmd === "list_profiles")
        return Promise.resolve([{ name: "work", kind: "subscription", active: false }]);
      return Promise.resolve(undefined);
    });
    const onAdded = vi.fn();
    render(<AddSubscriptionForm onAdded={onAdded} />);

    fireEvent.change(screen.getByLabelText("subscription profile name"), {
      target: { value: "work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add subscription profile" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("open_login_terminal", { name: "work" }),
    );
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
  });

  it("does nothing when the name field is empty", async () => {
    render(<AddSubscriptionForm onAdded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add subscription profile" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("shows a clean error and does not poll when open_login_terminal rejects", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "open_login_terminal") return Promise.reject("boom");
      return Promise.resolve(undefined);
    });
    render(<AddSubscriptionForm onAdded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("subscription profile name"), {
      target: { value: "work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add subscription profile" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
    expect(mockInvoke).not.toHaveBeenCalledWith("list_profiles");
  });
});
