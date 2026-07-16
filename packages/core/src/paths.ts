import { homedir } from "node:os";
import { join } from "node:path";

/** Thư mục gốc chứa mọi dữ liệu của ccm. CCM_HOME cho phép override (dùng khi test). */
export function ccmHome(): string {
  return process.env.CCM_HOME ?? join(homedir(), ".ccm");
}

export function profilesDir(): string {
  return join(ccmHome(), "profiles");
}

/** CLAUDE_CONFIG_DIR của một profile. */
export function profileDir(name: string): string {
  return join(profilesDir(), name);
}

export function configPath(): string {
  return join(ccmHome(), "config.json");
}

export function sessionsPath(): string {
  return join(ccmHome(), "state", "sessions.json");
}
