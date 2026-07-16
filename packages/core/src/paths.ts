import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Thư mục gốc chứa mọi dữ liệu của ccm. CCM_HOME cho phép override (dùng khi
 * test). Một CCM_HOME rỗng ("") bị coi như chưa set — fallback về ~/.ccm —
 * vì `""` gần như luôn là lỗi shell (unquoted expansion của biến rỗng) chứ
 * không phải ý định thật, và `join("", ...)` sẽ âm thầm tạo đường dẫn
 * tương đối theo CWD, ghi dữ liệu vào nơi không ngờ tới. Một CCM_HOME
 * tương đối hợp lệ (vd "./foo") được resolve thành tuyệt đối dựa trên CWD
 * hiện tại, thay vì bị reject — điều này khớp với cách hầu hết CLI tool xử
 * lý override path tương đối (git, docker, ...), và giữ bất biến "ccmHome()
 * luôn tuyệt đối" mà không làm bể lệnh của người dùng.
 */
export function ccmHome(): string {
  const override = process.env.CCM_HOME;
  if (!override) return join(homedir(), ".ccm");
  return isAbsolute(override) ? override : resolve(override);
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
