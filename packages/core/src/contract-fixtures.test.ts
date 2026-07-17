import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProfileUsage } from "./usage";
import { profileDir, configPath } from "./paths";
import { addProfile, loadConfig, setActive } from "./profile-store";

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

test("config.json fixture round-trips with canonical casing and known fields preserved", async () => {
  await copyFile(join(FIXTURES, "config.json"), configPath());

  const c = await loadConfig();
  expect(c.profiles).toEqual([
    { name: "Work", kind: "subscription" },
    { name: "bot", kind: "api-key" },
  ]);
  expect(c.active).toBe("Work"); // canonical casing preserved, not lowercased
  expect(c.failoverEnabled).toBe(true);
  expect(c.failoverOrder).toEqual(["Work", "bot"]);
  // Unknown field must round-trip: TS is lossless by construction
  // (readJson -> JSON.parse -> mutate -> JSON.stringify never drops fields
  // it doesn't declare in the Config interface). This is the counterpart to
  // the Rust `#[serde(flatten)]` fix on Config/Profile — this single assert
  // is exactly what would have caught that drift.
  expect((c as unknown as { telemetryOptIn: boolean }).telemetryOptIn).toBe(false);

  await setActive("bot");
  const raw = JSON.parse(await readFile(configPath(), "utf8"));
  expect(raw.telemetryOptIn).toBe(false);
  expect(raw.active).toBe("bot");
});

test("config-corrupt.json fixture is rejected, not silently swallowed", async () => {
  // config-corrupt.json is truncated/invalid JSON. readJson() only treats
  // ENOENT as "return null" (-> defaults); any other read/parse error
  // (including JSON.parse's SyntaxError here) propagates out of
  // loadConfig() as a rejected promise, so the app never silently proceeds
  // on a corrupt config.
  await copyFile(join(FIXTURES, "config-corrupt.json"), configPath());
  expect(loadConfig()).rejects.toThrow();
});
