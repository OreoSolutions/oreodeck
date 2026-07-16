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
 * `security`'s own man page: "Use of the -p or -w options is insecure.
 * Specify -w as the last option to be prompted." Passing the key via
 * `-w <key>` on argv puts it in the child's process argument list for the
 * lifetime of the `security` process — readable by any same-user process
 * via `ps -ww -o args` during `ccm add --api-key`. `security -i`
 * (interactive mode) reads one Keychain command per line from stdin
 * instead, so the key only ever travels through a pipe, never argv. Spiked
 * against a throwaway `com.oreo.ccm.spike` service (see
 * .superpowers/sdd/final-fixes-report.md) — reads back correctly for keys
 * containing spaces, quotes, `$`, and `!`, and does not appear in
 * `ps -ww -o args` for the `security -i` child at any point.
 */
function quoteForSecurityInteractive(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    // A newline would let the value be parsed as a second `security -i`
    // command instead of a token of this one — reject before it ever
    // reaches the child's stdin.
    throw new Error("Value contains a newline or NUL byte, which `security -i` cannot accept safely.");
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Runs one `security -i` command line, piping it via stdin instead of argv. */
function runSecurityInteractive(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("security", ["-i"], (err) => {
      if (err) reject(err);
      else resolve();
    });
    // `child` is undefined only under a test mock that stubs execFile
    // without returning a ChildProcess; production execFile always
    // returns one with stdio piped by default.
    child?.stdin?.end(`${command}\n`);
  });
}

/**
 * Lưu API key vào macOS Keychain. `-U` để ghi đè nếu đã tồn tại.
 */
export async function setApiKey(profile: string, key: string): Promise<void> {
  try {
    const command = [
      "add-generic-password",
      "-U",
      "-s", quoteForSecurityInteractive(SERVICE),
      "-a", quoteForSecurityInteractive(profile),
      "-w", quoteForSecurityInteractive(key),
    ].join(" ");
    await runSecurityInteractive(command);
  } catch {
    // Never rethrow the original error: even though the key no longer rides
    // argv, `security`'s stderr/stdin-command line could still end up in the
    // original error's `.message`/`.cmd`/`.stack` (e.g. Node's own execFile
    // error text). Do not attach it as `cause` either — that would just move
    // the leak somewhere loggers still serialize.
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
