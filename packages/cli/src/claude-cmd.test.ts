import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { addProfile, profileDir } from "@ccm/core";

let dir: string;
const CLI = join(import.meta.dir, "index.ts");
const FAKE = join(import.meta.dir, "..", "test", "fake-claude.sh");

async function ccm(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, CCM_HOME: dir, CCM_CLAUDE_BIN: FAKE },
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
  dir = await mkdtemp(join(tmpdir(), "ccm-run-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

test("claude runs with the active profile's config dir", async () => {
  await addProfile("work", "subscription");
  const { stdout, code } = await ccm("claude");
  expect(code).toBe(0);
  expect(stdout).toContain(`CLAUDE_CONFIG_DIR=${profileDir("work")}`);
});

test("claude -P overrides the active profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const { stdout } = await ccm("claude", "-P", "personal");
  expect(stdout).toContain(`CLAUDE_CONFIG_DIR=${profileDir("personal")}`);
});

test("claude forwards extra args through to the child", async () => {
  await addProfile("work", "subscription");
  const { stdout } = await ccm("claude", "--resume", "abc123");
  expect(stdout).toContain("ARGS=--resume abc123");
});

test("claude propagates the child's exit code", async () => {
  await addProfile("work", "subscription");
  const proc = Bun.spawn(["bun", CLI, "claude"], {
    env: { ...process.env, CCM_HOME: dir, CCM_CLAUDE_BIN: FAKE, FAKE_CLAUDE_EXIT: "7" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await proc.exited).toBe(7);
});

test("claude with no profiles exits 1 with a hint", async () => {
  const { stderr, code } = await ccm("claude");
  expect(code).toBe(1);
  expect(stderr).toContain("No active profile");
});

test("two profiles yield two distinct CLAUDE_CONFIG_DIR values, neither the real ~/.claude", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const work = await ccm("claude", "-P", "work");
  const personal = await ccm("claude", "-P", "personal");

  const workDirLine = work.stdout.split("\n").find((l) => l.startsWith("CLAUDE_CONFIG_DIR="));
  const personalDirLine = personal.stdout
    .split("\n")
    .find((l) => l.startsWith("CLAUDE_CONFIG_DIR="));

  expect(workDirLine).toBeDefined();
  expect(personalDirLine).toBeDefined();
  expect(workDirLine).not.toBe(personalDirLine);

  const realClaudeDir = join(homedir(), ".claude");
  expect(workDirLine).not.toContain(realClaudeDir);
  expect(personalDirLine).not.toContain(realClaudeDir);
});
