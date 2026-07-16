import { expect, test, afterEach, mock } from "bun:test";
import { setApiKey, getApiKey, deleteApiKey } from "./keychain";

const P = "ccm-test-kc";

afterEach(async () => {
  await deleteApiKey(P);
});

test("getApiKey returns null when absent", async () => {
  expect(await getApiKey("ccm-test-absent")).toBeNull();
});

test("set then get round-trips", async () => {
  await setApiKey(P, "sk-ant-test-123");
  expect(await getApiKey(P)).toBe("sk-ant-test-123");
});

test("set overwrites an existing key", async () => {
  await setApiKey(P, "sk-ant-old");
  await setApiKey(P, "sk-ant-new");
  expect(await getApiKey(P)).toBe("sk-ant-new");
});

test("delete removes the key", async () => {
  await setApiKey(P, "sk-ant-test-123");
  await deleteApiKey(P);
  expect(await getApiKey(P)).toBeNull();
});

test("deleteApiKey on missing key does not throw", async () => {
  await deleteApiKey("ccm-test-absent");
});

test("preserves a legitimate trailing space in the key, strips only the single newline `security -w` appends", async () => {
  const keyWithTrailingSpace = "sk-ant-trailing-space  ";
  await setApiKey(P, keyWithTrailingSpace);
  expect(await getApiKey(P)).toBe(keyWithTrailingSpace);
});

// --- I-1: key must travel via stdin, not argv -------------------------

test("round-trips keys containing spaces, quotes, and shell-special characters (security -i quoting)", async () => {
  const tricky = 'sk with space "quote" $dollar !bang \\backslash';
  await setApiKey(P, tricky);
  expect(await getApiKey(P)).toBe(tricky);
});

test("setApiKey rejects a key containing a newline instead of smuggling it into `security -i`", async () => {
  await expect(setApiKey(P, "sk-ant-good\nadd-generic-password -U -a evil -s evil -w pwned")).rejects.toThrow();
  // The injected second command must never have reached the Keychain.
  expect(await getApiKey("evil")).toBeNull();
});

test("the plaintext key never appears in the `security -i` child's argv (ps -ww -o args)", async () => {
  const SECRET = "SUPER-SECRET-PS-ARGV-CHECK";
  const { spawnSync } = await import("node:child_process");
  let sawLeak = false;

  const setPromise = setApiKey(P, SECRET);
  // Poll `ps` for every process's full argv while setApiKey's `security -i`
  // child may still be alive. If the key ever rode argv (the old `-w key`
  // form), it would show up here.
  for (let i = 0; i < 25; i++) {
    const out = spawnSync("ps", ["-ww", "-A", "-o", "args="]).stdout?.toString() ?? "";
    if (out.includes(SECRET)) sawLeak = true;
  }
  await setPromise;

  expect(sawLeak).toBe(false);
  expect(await getApiKey(P)).toBe(SECRET);
});

// --- Regression tests for FINDING 1 & 2 -------------------------------
//
// These mock "node:child_process" so we can force `security` to fail in
// ways that are not reliably reproducible against the real Keychain
// (repeated empirical testing showed `add-generic-password -U` tolerates
// empty/huge/odd profile & key values without failing; the only real
// failure triggers found — a locked/missing HOME, or a bad -T app path —
// either risk popping a GUI auth prompt or aren't reachable through
// setApiKey's fixed argv). Because keychain.ts does
// `const run = promisify(execFile)` at module load time, the functions
// imported statically above are already bound to the REAL execFile and
// are unaffected by `mock.module` calls below. Each mocked test instead
// dynamically imports keychain.ts under a cache-busting query string
// *after* installing the mock, so it gets a fresh module instance bound
// to the mocked execFile, while the real-Keychain tests above/below keep
// working against the real one.

type KeychainModule = typeof import("./keychain");
type MockableError = Error & { code?: number; cmd?: string };

// The specifier is built at runtime (not a string literal) so TypeScript
// treats the dynamic import as `Promise<any>` instead of trying to
// statically resolve the fake query-string module path.
async function freshKeychainModule(query: string): Promise<KeychainModule> {
  const specifier = `./keychain.ts?${query}`;
  return (await import(specifier)) as KeychainModule;
}

test("setApiKey never leaks the plaintext key when the security call fails", async () => {
  const SECRET = "SUPER-SECRET-KEY-VALUE-FINDING1";

  mock.module("node:child_process", () => ({
    execFile: (cmd: string, args: string[], callback: (err: unknown, stdout: string, stderr: string) => void) => {
      // Recreate exactly what a real `execFile` rejection looks like:
      // the full command line (including the plaintext key) embedded in
      // message/cmd, per Node's documented behavior.
      const cmdLine = `${cmd} ${args.join(" ")}`;
      const err: MockableError = new Error(`Command failed: ${cmdLine}\nsecurity: some failure\n`);
      err.cmd = cmdLine;
      err.code = 1;
      callback(err, "", "security: some failure\n");
    },
  }));

  const { setApiKey: mockedSetApiKey } = await freshKeychainModule("leak-check");

  let thrown: unknown;
  try {
    await mockedSetApiKey(P, SECRET);
  } catch (e) {
    thrown = e;
  }

  expect(thrown).toBeInstanceOf(Error);
  const err = thrown as Error & { cmd?: string; cause?: unknown };
  expect(err.message).not.toContain(SECRET);
  expect(err.cmd ?? "").not.toContain(SECRET);
  expect(err.stack ?? "").not.toContain(SECRET);
  expect(JSON.stringify(err)).not.toContain(SECRET);
  expect(err.cause).toBeUndefined();
});

test("getApiKey rethrows on a real failure instead of treating it as absent", async () => {
  mock.module("node:child_process", () => ({
    execFile: (_cmd: string, _args: string[], callback: (err: unknown, stdout: string, stderr: string) => void) => {
      const err: MockableError = new Error("Command failed: security find-generic-password ...");
      err.code = 1; // NOT the "item not found" code (44) — e.g. locked keychain.
      callback(err, "", "security: keychain locked\n");
    },
  }));

  const { getApiKey: mockedGetApiKey } = await freshKeychainModule("getfail-check");

  await expect(mockedGetApiKey(P)).rejects.toThrow();
});

test("deleteApiKey rethrows on a real failure instead of treating it as already gone", async () => {
  mock.module("node:child_process", () => ({
    execFile: (_cmd: string, _args: string[], callback: (err: unknown, stdout: string, stderr: string) => void) => {
      const err: MockableError = new Error("Command failed: security delete-generic-password ...");
      err.code = 1; // NOT the "item not found" code (44) — e.g. permission denied.
      callback(err, "", "security: permission denied\n");
    },
  }));

  const { deleteApiKey: mockedDeleteApiKey } = await freshKeychainModule("deletefail-check");

  await expect(mockedDeleteApiKey(P)).rejects.toThrow();
});

test("getApiKey and deleteApiKey still treat exit code 44 as not-found", async () => {
  mock.module("node:child_process", () => ({
    execFile: (_cmd: string, _args: string[], callback: (err: unknown, stdout: string, stderr: string) => void) => {
      const err: MockableError = new Error("security: item not found");
      err.code = 44;
      callback(err, "", "security: item not found\n");
    },
  }));

  const { getApiKey: mockedGetApiKey, deleteApiKey: mockedDeleteApiKey } = await freshKeychainModule("notfound-check");

  expect(await mockedGetApiKey(P)).toBeNull();
  await expect(mockedDeleteApiKey(P)).resolves.toBeUndefined();
});
