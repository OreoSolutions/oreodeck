import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, stat as fsStat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRateLimitOutput,
  nextProfile,
  setFailoverOrder,
  setFailoverEnabled,
  findLatestSession,
  findSessionForRun,
  copySessionToProfile,
  listImportableSessions,
  importSessionToProfile,
} from "./failover";
import { addProfile, loadConfig } from "./profile-store";
import { profileDir } from "./paths";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-fo-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

test("lists global and other-profile sessions but excludes destination and subagents", async () => {
  process.env.CCM_GLOBAL_CLAUDE_HOME = join(dir, "global");
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const globalSession = join(dir, "global", "projects", "-tmp-app", "global-id.jsonl");
  const otherSession = join(profileDir("personal"), "projects", "-tmp-api", "other-id.jsonl");
  const ownSession = join(profileDir("work"), "projects", "-tmp-own", "own-id.jsonl");
  const subagent = join(profileDir("personal"), "projects", "-tmp-api", "other-id", "subagents", "agent-x.jsonl");
  for (const path of [globalSession, otherSession, ownSession, subagent]) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify({ cwd: "/tmp/app", message: { role: "user", content: "Fix the dashboard" } }) + "\n");
  }
  const sessions = await listImportableSessions("work");
  expect(sessions.map((item) => item.id).sort()).toEqual(["global-id", "other-id"]);
  expect(sessions.find((item) => item.id === "global-id")?.source).toBe("global");
  const selected = sessions.find((item) => item.id === "other-id")!;
  await importSessionToProfile(selected, "work");
  expect(await Bun.file(join(profileDir("work"), "projects", "-tmp-api", "other-id.jsonl")).text()).toContain("Fix the dashboard");
  delete process.env.CCM_GLOBAL_CLAUDE_HOME;
});

test("isRateLimitOutput detects the usage-limit message", () => {
  expect(isRateLimitOutput("Claude usage limit reached. Your limit will reset at 3pm.")).toBe(true);
  expect(isRateLimitOutput("Error: rate_limit_error")).toBe(true);
  expect(isRateLimitOutput("429 Too Many Requests")).toBe(true);
});

test("isRateLimitOutput ignores unrelated output", () => {
  expect(isRateLimitOutput("Here is your answer.")).toBe(false);
  expect(isRateLimitOutput("")).toBe(false);
});

test("nextProfile returns the following profile in order", () => {
  expect(nextProfile("a", ["a", "b", "c"], new Set(["a"]))).toBe("b");
});

test("nextProfile skips already-exhausted profiles", () => {
  expect(nextProfile("a", ["a", "b", "c"], new Set(["a", "b"]))).toBe("c");
});

test("nextProfile wraps around the order", () => {
  expect(nextProfile("c", ["a", "b", "c"], new Set(["c"]))).toBe("a");
});

test("nextProfile returns null when every profile is exhausted", () => {
  expect(nextProfile("a", ["a", "b"], new Set(["a", "b"]))).toBeNull();
});

test("nextProfile returns null for a single-profile order", () => {
  expect(nextProfile("a", ["a"], new Set(["a"]))).toBeNull();
});

test("nextProfile returns null for an empty order", () => {
  expect(nextProfile("a", [], new Set())).toBeNull();
});

test("nextProfile handles current not present in order by scanning from the start", () => {
  // "current" isn't in `order` at all (e.g. stale/renamed profile); indexOf
  // is -1, so the scan starts at index 0 of `order` — the first unexhausted
  // profile in the list is returned rather than throwing or looping forever.
  expect(nextProfile("ghost", ["a", "b"], new Set())).toBe("a");
  expect(nextProfile("ghost", ["a", "b"], new Set(["a"]))).toBe("b");
});

test("setFailoverEnabled persists the flag", async () => {
  await setFailoverEnabled(false);
  expect((await loadConfig()).failoverEnabled).toBe(false);
});

test("setFailoverOrder persists a reordering", async () => {
  await addProfile("a", "subscription");
  await addProfile("b", "subscription");
  await setFailoverOrder(["b", "a"]);
  expect((await loadConfig()).failoverOrder).toEqual(["b", "a"]);
});

test("setFailoverOrder rejects an unknown profile", async () => {
  await addProfile("a", "subscription");
  expect(setFailoverOrder(["a", "ghost"])).rejects.toThrow("not found");
});

test("setFailoverOrder matches profile names case-insensitively and stores canonical casing", async () => {
  await addProfile("b", "subscription");
  await addProfile("a", "subscription");
  await setFailoverOrder(["B", "a"]);
  expect((await loadConfig()).failoverOrder).toEqual(["b", "a"]);
});

test("setFailoverOrder keeps unlisted profiles at the tail, matched case-insensitively", async () => {
  await addProfile("a", "subscription");
  await addProfile("b", "subscription");
  await addProfile("c", "subscription");
  await setFailoverOrder(["C"]);
  expect((await loadConfig()).failoverOrder).toEqual(["c", "a", "b"]);
});

test("findLatestSession returns the most recently modified transcript", async () => {
  await addProfile("work", "subscription");
  const proj = join(profileDir("work"), "projects", "demo");
  await mkdir(proj, { recursive: true });
  await writeFile(join(proj, "old.jsonl"), "{}\n");
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(join(proj, "new.jsonl"), "{}\n");
  const found = await findLatestSession("work");
  expect(found?.id).toBe("new");
});

test("findLatestSession returns null when the profile has no transcripts", async () => {
  await addProfile("fresh", "subscription");
  expect(await findLatestSession("fresh")).toBeNull();
});

test("findSessionForRun returns only one transcript modified by this run", async () => {
  const root = join(profileDir("work"), "projects", "project-a");
  await mkdir(root, { recursive: true });
  const launchedAt = Date.now();
  await Bun.write(join(root, "current.jsonl"), "{}\n");
  expect((await findSessionForRun("work", launchedAt))?.id).toBe("current");
  await Bun.write(join(root, "parallel.jsonl"), "{}\n");
  expect(await findSessionForRun("work", launchedAt)).toBeNull();
});

test("copySessionToProfile mirrors the relative path into the target profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const proj = join(profileDir("work"), "projects", "demo");
  await mkdir(proj, { recursive: true });
  const src = join(proj, "s1.jsonl");
  await writeFile(src, "{}\n");
  await copySessionToProfile(src, "work", "personal");
  const dest = join(profileDir("personal"), "projects", "demo", "s1.jsonl");
  expect((await fsStat(dest)).isFile()).toBe(true);
});

test("copySessionToProfile rejects a session path outside the source profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const outside = join(profileDir("work"), "..", "..", "evil.jsonl");
  expect(copySessionToProfile(outside, "work", "personal")).rejects.toThrow("outside profile");
});
