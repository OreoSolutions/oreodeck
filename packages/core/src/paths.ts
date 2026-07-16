import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Thư mục gốc chứa mọi dữ liệu của ccm. CCM_HOME cho phép override (dùng khi
 * test). Một CCM_HOME rỗng ("") hoặc chỉ chứa khoảng trắng (" ", "\t", "\n",
 * ...) bị coi như chưa set — fallback về ~/.ccm — vì cả hai đều gần như
 * luôn là lỗi shell (unquoted expansion của biến rỗng, hoặc giá trị dán
 * nhầm khoảng trắng) chứ không phải ý định thật. Nếu không trim trước khi
 * kiểm tra, `" "` sẽ vượt qua check `!override` (nó truthy) rồi rơi vào
 * `resolve(" ")`, âm thầm tạo đường dẫn tương đối theo CWD giống hệt lỗi
 * gốc với `""`. Giá trị sau khi trim được dùng để resolve — không dùng giá
 * trị gốc — nên `" ./foo "` vẫn resolve đúng thành `<cwd>/foo` thay vì một
 * đường dẫn có khoảng trắng ở đầu/cuối. Một CCM_HOME tương đối hợp lệ (vd
 * "./foo") được resolve thành tuyệt đối dựa trên CWD hiện tại, thay vì bị
 * reject — điều này khớp với cách hầu hết CLI tool xử lý override path
 * tương đối (git, docker, ...), và giữ bất biến "ccmHome() luôn tuyệt đối"
 * mà không làm bể lệnh của người dùng.
 */
export function ccmHome(): string {
  const override = process.env.CCM_HOME?.trim();
  if (!override) return join(homedir(), ".ccm");
  return isAbsolute(override) ? override : resolve(override);
}

export function profilesDir(): string {
  return join(ccmHome(), "profiles");
}

/** Tên profile thành tên thư mục, nên phải chặn path traversal. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Chặn path traversal / tên bất hợp lệ trước bất kỳ thao tác nào đụng tới
 * filesystem hoặc spawn. Nguồn duy nhất của rule này — profile-store.ts
 * import lại hàm này thay vì tự định nghĩa NAME_RE riêng, để tránh hai bản
 * lệch nhau. Dùng cho cả input từ CLI lẫn tên đọc lại từ config.json —
 * config có thể bị sửa tay/hỏng.
 */
export function assertValidName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid profile name: ${JSON.stringify(name)}. Use letters, digits, - and _ (max 64 chars).`,
    );
  }
}

/**
 * CLAUDE_CONFIG_DIR của một profile. Đây là chokepoint duy nhất: mọi đường
 * dẫn filesystem/spawn phái sinh từ profile name (launcher, failover, usage,
 * add-login) đều đi qua profileDir(), nên validate ở đây chặn traversal cho
 * toàn bộ những nơi đó cùng lúc — kể cả khi tên đến từ config.json bị sửa
 * tay/hỏng, chứ không chỉ từ input CLI hợp lệ.
 */
export function profileDir(name: string): string {
  assertValidName(name);
  return join(profilesDir(), name);
}

export function configPath(): string {
  return join(ccmHome(), "config.json");
}

export function sessionsPath(): string {
  return join(ccmHome(), "state", "sessions.json");
}
