import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProfileUsage } from "./usage";
import { profileDir } from "./paths";
import { addProfile } from "./profile-store";

const FIXTURES = join(import.meta.dir, "..", "..", "contract-fixtures");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-contract-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

test("readProfileUsage matches the golden expected-usage.json", async () => {
  const expected = JSON.parse(
    await readFile(join(FIXTURES, "expected-usage.json"), "utf8"),
  );
  await addProfile("work", "subscription");
  const proj = join(profileDir("work"), "projects", "demo");
  await mkdir(proj, { recursive: true });
  await copyFile(join(FIXTURES, "transcript.jsonl"), join(proj, "session.jsonl"));

  const u = await readProfileUsage("work", expected.nowMs);
  expect(u.entries).toBe(expected.usage.entries);
  expect(u.inputTokens).toBe(expected.usage.inputTokens);
  expect(u.cacheWrite5mTokens).toBe(expected.usage.cacheWrite5mTokens);
  expect(u.cacheWrite1hTokens).toBe(expected.usage.cacheWrite1hTokens);
  expect(u.cacheReadTokens).toBe(expected.usage.cacheReadTokens);
  expect(u.outputTokens).toBe(expected.usage.outputTokens);
  expect(u.totalTokens).toBe(expected.usage.totalTokens);
  expect(u.costUsd).toBeCloseTo(expected.usage.costUsd, 6);
  expect(u.resetAt).toBe(expected.usage.resetAtMs);
});
