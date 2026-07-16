import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile } from "@ccm/core";

let dir: string;
const CLI = join(import.meta.dir, "index.ts");
const FAKE = join(import.meta.dir, "..", "test", "fake-claude-limited.sh");

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
  dir = await mkdtemp(join(tmpdir(), "ccm-fo-cli-"));
  process.env.CCM_HOME = dir;
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

test("headless run falls over to the next profile on a rate limit", async () => {
  const { stdout, stderr, code } = await ccm("claude", "-p", "hello");
  expect(stdout).toContain("OK from personal");
  expect(stderr).toContain('retrying with "personal"');
  expect(code).toBe(0);
});

test("failover off disables the retry", async () => {
  await ccm("failover", "off");
  const { stdout, code } = await ccm("claude", "-p", "hello");
  expect(stdout).not.toContain("OK from personal");
  expect(code).toBe(1);
});
