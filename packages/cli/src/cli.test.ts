import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile } from "@ccm/core";

let dir: string;

const CLI = join(import.meta.dir, "index.ts");

/** Chạy `ccm` như một tiến trình con, với CCM_HOME trỏ vào thư mục test. */
async function ccm(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, CCM_HOME: dir },
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
  dir = await mkdtemp(join(tmpdir(), "ccm-cli-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

test("list with no profiles prints a hint", async () => {
  const { stdout, code } = await ccm("list");
  expect(code).toBe(0);
  expect(stdout).toContain("No profiles");
});

test("list shows profiles and marks the active one", async () => {
  await addProfile("work", "subscription");
  await addProfile("bot", "api-key");
  const { stdout, code } = await ccm("list");
  expect(code).toBe(0);
  expect(stdout).toContain("work");
  expect(stdout).toContain("bot");
  expect(stdout).toContain("api-key");
  expect(stdout).toMatch(/\*\s+work/);
});

test("use switches the active profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const { code } = await ccm("use", "personal");
  expect(code).toBe(0);
  const after = await ccm("list");
  expect(after.stdout).toMatch(/\*\s+personal/);
});

test("use with an unknown profile exits 1 with an error", async () => {
  const { stderr, code } = await ccm("use", "ghost");
  expect(code).toBe(1);
  expect(stderr).toContain("not found");
});

// F-7: bare `ccm` should behave like `--help` (print help, exit 0), not
// commander's default "missing subcommand" path which exits 1.
test("bare ccm with no args prints help and exits 0", async () => {
  const { stdout, code } = await ccm();
  expect(code).toBe(0);
  expect(stdout).toContain("Usage: ccm");
  expect(stdout).toContain("Commands:");
});

test("ccm --help still exits 0 and prints help", async () => {
  const { stdout, code } = await ccm("--help");
  expect(code).toBe(0);
  expect(stdout).toContain("Usage: ccm");
});

test("an unknown command still exits nonzero", async () => {
  const { stderr, code } = await ccm("bogus-command");
  expect(code).not.toBe(0);
  expect(stderr).toContain("unknown command");
});
