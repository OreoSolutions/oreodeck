import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SERVICE = "com.oreo.ccm";

/** `security` exits with 44 when an item cannot be found (verified via
 * `security find-generic-password -s com.oreo.ccm -a <absent>`). Any other
 * non-zero exit is a real failure (locked keychain, permission denied,
 * corrupted keychain, ...) and must not be swallowed. */
const ITEM_NOT_FOUND_CODE = 44;

/**
 * Lưu API key vào macOS Keychain. `-U` để ghi đè nếu đã tồn tại.
 * Key truyền qua argv chứ không qua shell, nên không có nguy cơ shell injection.
 */
export async function setApiKey(profile: string, key: string): Promise<void> {
  try {
    await run("security", [
      "add-generic-password",
      "-U",
      "-s", SERVICE,
      "-a", profile,
      "-w", key,
    ]);
  } catch {
    // Never rethrow the original error: `security`'s argv (including the
    // plaintext key passed via `-w`) ends up in the original error's
    // `.message`, `.cmd`, and `.stack`. Do not attach it as `cause` either —
    // that would just move the leak somewhere loggers still serialize.
    throw new Error(
      `Failed to save API key for profile "${profile}" to macOS Keychain.`,
    );
  }
}

export async function getApiKey(profile: string): Promise<string | null> {
  try {
    const { stdout } = await run("security", [
      "find-generic-password",
      "-s", SERVICE,
      "-a", profile,
      "-w",
    ]);
    // `security -w` appends exactly one trailing newline; strip only that,
    // not arbitrary trailing whitespace that may be part of the key.
    return stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw new Error(
      `Failed to read API key for profile "${profile}" from macOS Keychain.`,
    );
  }
}

export async function deleteApiKey(profile: string): Promise<void> {
  try {
    await run("security", [
      "delete-generic-password",
      "-s", SERVICE,
      "-a", profile,
    ]);
  } catch (err) {
    if (isNotFoundError(err)) return; // Không tồn tại thì coi như đã xóa xong.
    throw new Error(
      `Failed to delete API key for profile "${profile}" from macOS Keychain.`,
    );
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === ITEM_NOT_FOUND_CODE
  );
}
