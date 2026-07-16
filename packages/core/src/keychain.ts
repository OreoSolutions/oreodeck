import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SERVICE = "com.oreo.ccm";

/**
 * Lưu API key vào macOS Keychain. `-U` để ghi đè nếu đã tồn tại.
 * Key truyền qua argv chứ không qua shell, nên không có nguy cơ shell injection.
 */
export async function setApiKey(profile: string, key: string): Promise<void> {
  await run("security", [
    "add-generic-password",
    "-U",
    "-s", SERVICE,
    "-a", profile,
    "-w", key,
  ]);
}

export async function getApiKey(profile: string): Promise<string | null> {
  try {
    const { stdout } = await run("security", [
      "find-generic-password",
      "-s", SERVICE,
      "-a", profile,
      "-w",
    ]);
    return stdout.trimEnd();
  } catch {
    // `security` trả exit code khác 0 khi không tìm thấy entry.
    return null;
  }
}

export async function deleteApiKey(profile: string): Promise<void> {
  try {
    await run("security", [
      "delete-generic-password",
      "-s", SERVICE,
      "-a", profile,
    ]);
  } catch {
    // Không tồn tại thì coi như đã xóa xong.
  }
}
