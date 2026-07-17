import { invoke } from "@tauri-apps/api/core";

export type ProfileKind = "subscription" | "api-key";

export interface ProfileView {
  name: string;
  kind: ProfileKind;
  active: boolean;
}

export interface ProfileUsageView {
  profile: string;
  kind: string;
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  resetAt: number | null;
  active: boolean;
}

export interface FailoverView {
  enabled: boolean;
  order: string[];
}

/** Sentinel Rust trả khi config.json hỏng — App hiện banner thay vì crash. */
export const CONFIG_CORRUPT = "CONFIG_CORRUPT";

/**
 * Single boundary that turns a raw thrown value into text safe to show the user.
 * Every `setError`/alert in the app must route through this — it is what stops the
 * CONFIG_CORRUPT sentinel (or any other machine-readable rejection) from leaking
 * verbatim into a `role="alert"` banner.
 */
export function toUserMessage(e: unknown): string {
  if (String(e) === CONFIG_CORRUPT) {
    return "Your ~/.ccm/config.json is corrupt and could not be read. ccm changed nothing.";
  }
  return String(e);
}

export const listProfiles = () => invoke<ProfileView[]>("list_profiles");
export const getUsage = () => invoke<ProfileUsageView[]>("get_usage");
export const setActive = (name: string) => invoke<void>("set_active", { name });
export const addApiKeyProfile = (name: string, key: string) =>
  invoke<void>("add_api_key_profile", { name, key });
export const removeProfile = (name: string) => invoke<void>("remove_profile", { name });
export const getFailover = () => invoke<FailoverView>("get_failover");
export const setFailoverEnabled = (enabled: boolean) =>
  invoke<void>("set_failover_enabled", { enabled });
export const setFailoverOrder = (order: string[]) =>
  invoke<void>("set_failover_order", { order });
export const openSession = (name: string) => invoke<void>("open_session", { name });
export const openLoginTerminal = (name: string) =>
  invoke<void>("open_login_terminal", { name });
export const checkCli = () => invoke<{ installed: boolean }>("check_cli");
export const openConfigInEditor = () => invoke<void>("open_config_in_editor");
