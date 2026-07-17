import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import AddApiKeyForm from "./AddApiKeyForm";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("AddApiKeyForm", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("uses a password field and clears the key from state after submit", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const onAdded = vi.fn();
    render(<AddApiKeyForm onAdded={onAdded} />);

    const key = screen.getByLabelText("api key") as HTMLInputElement;
    expect(key.type).toBe("password");

    fireEvent.change(screen.getByLabelText("profile name"), { target: { value: "bot" } });
    fireEvent.change(key, { target: { value: "sk-ant-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add API key profile" }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(mockInvoke).toHaveBeenCalledWith("add_api_key_profile", {
      name: "bot",
      key: "sk-ant-secret",
    });
    expect(key.value).toBe(""); // key wiped from component state
  });
});
