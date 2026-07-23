import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { addProfile, profileDir, saveConfig } from "@ccm/core";

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

test("run is the primary OreoDeck command", async () => {
  await addProfile("work", "subscription");
  const { stdout, code } = await ccm("run");
  expect(code).toBe(0);
  expect(stdout).toContain(profileDir("work"));
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
    stdin: "pipe",
  });
  proc.stdin.write("n\n");
  proc.stdin.end();
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

// I-2: a hand-edited/corrupted config.json (or an attacker-chosen -P value
// that happens to match one) can carry a traversal name. profileDir() must
// reject it at the chokepoint before any spawn or filesystem write happens
// — reproduces the reviewer's `ccm claude -P "../../../../../../tmp/..."`
// finding with a fake binary instead of the real `claude`.
test("claude -P with a path-traversal profile name fails clean and never spawns (I-2)", async () => {
  await saveConfig({
    profiles: [{ name: "../evil", kind: "subscription" }],
    active: null,
    failoverEnabled: true,
    failoverOrder: ["../evil"],
  });
  const { stdout, stderr, code } = await ccm("claude", "-P", "../evil");
  expect(code).toBe(1);
  expect(stderr).toContain("Invalid profile name");
  // The fake binary never ran: no CLAUDE_CONFIG_DIR/ARGS line was printed.
  expect(stdout).not.toContain("CLAUDE_CONFIG_DIR=");
  expect(stdout).not.toContain("ARGS=");
  // Nothing was created outside CCM_HOME (one level up from `profiles/`).
  await expect(stat(join(dir, "evil"))).rejects.toThrow();
});

// promptConfirm dùng readline trên process.stdin; khi stdin là pipe (không
// TTY) nó vẫn đọc được một dòng bình thường, nên các test dưới đây pipe
// "n\n"/"" vào stdin để lái interactive loop mà không cần TTY thật.
test("interactive claude on a clean exit launches once and never prompts", async () => {
  await addProfile("work", "subscription");
  const proc = Bun.spawn(["bun", CLI, "claude", "-P", "work"], {
    env: { ...process.env, CCM_HOME: dir, CCM_CLAUDE_BIN: FAKE },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.end();
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  expect(code).toBe(0);
  expect(stdout).not.toContain("[y/N]");
  // ARGS= xuất hiện đúng một lần: fake binary chỉ chạy một lần duy nhất.
  expect(stdout.match(/ARGS=/g)?.length).toBe(1);
});

test("interactive claude does not treat an arbitrary non-zero exit as a rate limit", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const LIMITED = join(import.meta.dir, "..", "test", "fake-claude-limited.sh");
  const proc = Bun.spawn(["bun", CLI, "claude", "-P", "work"], {
    env: { ...process.env, CCM_HOME: dir, CCM_CLAUDE_BIN: LIMITED },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write("n\n");
  proc.stdin.end();
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  // Declining keeps the child's own exit code (1) rather than a hardcoded value.
  expect(code).toBe(1);
  expect(stdout).toContain('Confirm a usage limit and continue this conversation on "personal"?');
  // fake-claude-limited.sh's rate-limit line appears exactly once — no retry launch.
  expect(stdout.match(/Claude usage limit reached/g)?.length).toBe(1);
  expect(stdout).not.toContain("OK from personal");
});

test("interactive claude asks for failover only after the user confirms a usage limit", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const LIMITED = join(import.meta.dir, "..", "test", "fake-claude-limited.sh");
  const proc = Bun.spawn(["bun", CLI, "claude", "-P", "work"], {
    env: { ...process.env, CCM_HOME: dir, CCM_CLAUDE_BIN: LIMITED },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write("y\n");
  proc.stdin.end();
  const [stdout, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  expect(code).toBe(0);
  expect(stdout).toContain('Confirm a usage limit and continue this conversation on "personal"?');
  expect(stdout.match(/Claude usage limit reached/g)?.length).toBe(1);
  expect(stdout).toContain("OK from personal");
});
