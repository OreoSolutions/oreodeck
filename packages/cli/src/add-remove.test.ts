import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, addProfile, profileDir, deleteApiKey } from "@ccm/core";

let dir: string;
const CLI = join(import.meta.dir, "index.ts");

async function ccm(args: string[], stdin?: string) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, CCM_HOME: dir, CCM_SKIP_LOGIN: "1" },
    stdin: stdin ? new TextEncoder().encode(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, code: await proc.exited };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-addrm-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
  // `--api-key` tests write to the REAL macOS Keychain (it's global, not
  // scoped by CCM_HOME like the rest of a profile's data). removeProfile()
  // isn't called in every test path, so clean up directly here — otherwise
  // every test run leaves a stray "com.oreo.ccm"/"bot" entry behind.
  // deleteApiKey() is a no-op if the entry doesn't exist.
  await deleteApiKey("bot");
});

test("add creates a subscription profile", async () => {
  const { code } = await ccm(["add", "work"]);
  expect(code).toBe(0);
  const c = await loadConfig();
  expect(c.profiles).toEqual([{ name: "work", kind: "subscription" }]);
  expect((await stat(profileDir("work"))).isDirectory()).toBe(true);
});

test("add --api-key reads the key from stdin and stores an api-key profile", async () => {
  const { code } = await ccm(["add", "bot", "--api-key"], "sk-ant-test-xyz\n");
  expect(code).toBe(0);
  const c = await loadConfig();
  expect(c.profiles).toEqual([{ name: "bot", kind: "api-key" }]);
});

test("add --api-key never writes the key into config.json", async () => {
  await ccm(["add", "bot", "--api-key"], "sk-ant-secret-xyz\n");
  const raw = await Bun.file(join(dir, "config.json")).text();
  expect(raw).not.toContain("sk-ant-secret-xyz");
});

test("add rejects a duplicate name", async () => {
  await ccm(["add", "work"]);
  const { stderr, code } = await ccm(["add", "work"]);
  expect(code).toBe(1);
  expect(stderr).toContain("already exists");
});

test("remove --yes deletes the profile without prompting", async () => {
  await addProfile("work", "subscription");
  const { code } = await ccm(["remove", "work", "--yes"]);
  expect(code).toBe(0);
  expect((await loadConfig()).profiles).toEqual([]);
});

test("remove of an unknown profile exits 1", async () => {
  const { stderr, code } = await ccm(["remove", "ghost", "--yes"]);
  expect(code).toBe(1);
  expect(stderr).toContain("not found");
});
