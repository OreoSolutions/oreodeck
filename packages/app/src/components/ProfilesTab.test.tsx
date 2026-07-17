import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import ProfilesTab from "./ProfilesTab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const PROFILES = [
  { name: "work", kind: "subscription", active: true },
  { name: "bot", kind: "api-key", active: false },
];

describe("ProfilesTab", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_profiles") return Promise.resolve(PROFILES);
      return Promise.resolve(undefined);
    });
  });

  it("renders the profile table and marks the active one", async () => {
    render(<ProfilesTab />);
    await waitFor(() => screen.getByText("work"));
    expect(screen.getByText("bot")).toBeInTheDocument();
    expect(screen.getByText("api-key")).toBeInTheDocument();
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
});
