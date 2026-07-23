import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile } from "./profile-store";
import { profileDir } from "./paths";
import {
  WINDOW_MS,
  parseTranscriptLine,
  estimateCostUsd,
  readProfileUsage,
  readClaudePlanUsage,
  type UsageEntry,
} from "./usage";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-usage-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

const FIXTURE = join(import.meta.dir, "..", "test", "fixtures", "transcript.jsonl");

// --- parseTranscriptLine ---------------------------------------------------

test("parseTranscriptLine extracts all four token classes, splitting cache writes via cache_creation", () => {
  const line = JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-16T10:00:05.000Z",
    message: {
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_creation_input_tokens: 8000,
        cache_read_input_tokens: 5000,
        cache_creation: { ephemeral_5m_input_tokens: 6000, ephemeral_1h_input_tokens: 2000 },
      },
    },
  });
  const entry = parseTranscriptLine(line);
  expect(entry).toEqual({
    timestamp: Date.parse("2026-07-16T10:00:05.000Z"),
    model: "claude-opus-4-8",
    inputTokens: 1200,
    cacheWrite5mTokens: 6000,
    cacheWrite1hTokens: 2000,
    cacheReadTokens: 5000,
    outputTokens: 300,
  });
});

test("parseTranscriptLine falls back to 5m when cache_creation is absent", () => {
  const line = JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-16T10:00:05.000Z",
    message: {
      model: "claude-opus-4-8",
      usage: {
        input_tokens: 400,
        output_tokens: 150,
        cache_creation_input_tokens: 3000,
      },
    },
  });
  const entry = parseTranscriptLine(line);
  expect(entry?.cacheWrite5mTokens).toBe(3000);
  expect(entry?.cacheWrite1hTokens).toBe(0);
});

test("parseTranscriptLine defaults missing numeric fields to 0", () => {
  const line = JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-16T10:05:00.000Z",
    message: { model: "claude-opus-4-8", usage: { input_tokens: 400, output_tokens: 150 } },
  });
  const entry = parseTranscriptLine(line);
  expect(entry).toEqual({
    timestamp: Date.parse("2026-07-16T10:05:00.000Z"),
    model: "claude-opus-4-8",
    inputTokens: 400,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 150,
  });
});

test("parseTranscriptLine returns null for a user line", () => {
  expect(
    parseTranscriptLine(
      JSON.stringify({ type: "user", timestamp: "2026-07-16T10:00:00.000Z", message: {} }),
    ),
  ).toBeNull();
});

test("parseTranscriptLine returns null for a summary line", () => {
  expect(parseTranscriptLine(JSON.stringify({ type: "summary", summary: "chat" }))).toBeNull();
});

test("parseTranscriptLine returns null for malformed JSON", () => {
  expect(parseTranscriptLine("{not json")).toBeNull();
});

test("parseTranscriptLine returns null for an empty string", () => {
  expect(parseTranscriptLine("")).toBeNull();
});

test("parseTranscriptLine returns null for an assistant line with an unparseable timestamp", () => {
  const line = JSON.stringify({
    type: "assistant",
    timestamp: "not-a-date",
    message: { model: "claude-opus-4-8", usage: { input_tokens: 1, output_tokens: 1 } },
  });
  expect(parseTranscriptLine(line)).toBeNull();
});

test("parseTranscriptLine returns null for an assistant line with no usage", () => {
  const line = JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-16T10:00:00.000Z",
    message: { model: "claude-opus-4-8" },
  });
  expect(parseTranscriptLine(line)).toBeNull();
});

// --- estimateCostUsd --------------------------------------------------------

function entry(overrides: Partial<UsageEntry>): UsageEntry {
  return {
    timestamp: 0,
    model: "claude-opus-4-8",
    inputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

test("estimateCostUsd prices a pure input/output entry correctly (opus, 1M in + 1M out -> $30)", () => {
  const cost = estimateCostUsd(entry({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
  expect(cost).toBeCloseTo(30, 6);
});

test("estimateCostUsd applies 1.25x to 5m cache writes", () => {
  const cost = estimateCostUsd(entry({ cacheWrite5mTokens: 1_000_000 }));
  expect(cost).toBeCloseTo(6.25, 6);
});

test("estimateCostUsd applies 2x to 1h cache writes", () => {
  const cost = estimateCostUsd(entry({ cacheWrite1hTokens: 1_000_000 }));
  expect(cost).toBeCloseTo(10, 6);
});

test("estimateCostUsd applies 0.1x to cache reads", () => {
  const cost = estimateCostUsd(entry({ cacheReadTokens: 1_000_000 }));
  expect(cost).toBeCloseTo(0.5, 6);
});

test("estimateCostUsd returns 0 for an unknown model", () => {
  const cost = estimateCostUsd(
    entry({ model: "claude-unknown-9", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  );
  expect(cost).toBe(0);
});

test("estimateCostUsd recognizes current and dated model IDs", () => {
  expect(estimateCostUsd(entry({ model: "claude-sonnet-4-6", inputTokens: 1_000_000 }))).toBe(3);
  expect(estimateCostUsd(entry({ model: "claude-haiku-4-5-20251001", outputTokens: 1_000_000 }))).toBe(5);
  expect(estimateCostUsd(entry({ model: "claude-sonnet-5", inputTokens: 1_000_000 }))).toBe(2);
  expect(estimateCostUsd(entry({
    model: "claude-sonnet-5", timestamp: Date.parse("2026-09-01T00:00:00Z"),
    inputTokens: 1_000_000,
  }))).toBe(3);
});

// --- readProfileUsage --------------------------------------------------------

test("readProfileUsage sums every token class inside the 5-hour window and reports totalTokens", async () => {
  await addProfile("work", "subscription");
  const dest = join(profileDir("work"), "projects", "demo");
  await mkdir(dest, { recursive: true });
  await copyFile(FIXTURE, join(dest, "session.jsonl"));

  const now = Date.parse("2026-07-16T10:10:00.000Z");
  const usage = await readProfileUsage("work", now);

  expect(usage.entries).toBe(2);
  expect(usage.inputTokens).toBe(1600);
  expect(usage.cacheWrite5mTokens).toBe(8000);
  expect(usage.cacheWrite1hTokens).toBe(0);
  expect(usage.cacheReadTokens).toBe(5000);
  expect(usage.outputTokens).toBe(450);
  expect(usage.totalTokens).toBe(1600 + 8000 + 0 + 5000 + 450);
});

test("readProfileUsage excludes entries older than the window and reports resetAt: null when empty", async () => {
  await addProfile("work", "subscription");
  const dest = join(profileDir("work"), "projects", "demo");
  await mkdir(dest, { recursive: true });
  await copyFile(FIXTURE, join(dest, "session.jsonl"));

  const now = Date.parse("2026-07-16T10:05:00.000Z") + WINDOW_MS + 1000;
  const usage = await readProfileUsage("work", now);

  expect(usage.entries).toBe(0);
  expect(usage.totalTokens).toBe(0);
  expect(usage.resetAt).toBeNull();
});

test("readProfileUsage returns zeros for a profile that has never run (no projects dir)", async () => {
  await addProfile("work", "subscription");
  const usage = await readProfileUsage("work");
  expect(usage).toEqual({
    profile: "work",
    entries: 0,
    inputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    windowStart: usage.windowStart,
    resetAt: null,
  });
});

test("resetAt equals the earliest in-window entry's timestamp + WINDOW_MS", async () => {
  await addProfile("work", "subscription");
  const dest = join(profileDir("work"), "projects", "demo");
  await mkdir(dest, { recursive: true });
  await copyFile(FIXTURE, join(dest, "session.jsonl"));

  const now = Date.parse("2026-07-16T10:10:00.000Z");
  const usage = await readProfileUsage("work", now);
  expect(usage.resetAt).toBe(Date.parse("2026-07-16T10:00:05.000Z") + WINDOW_MS);
});

test("reads authoritative account limits cached by Claude Code", async () => {
  await addProfile("work", "subscription");
  await writeFile(join(profileDir("work"), ".claude.json"), JSON.stringify({
    cachedUsageUtilization: {
      fetchedAtMs: 1_784_781_109_168,
      accountUuid: "must-not-be-returned",
      utilization: {
        limits: [
          { kind: "session", percent: 75, resets_at: "2026-07-23T06:00:00Z", is_active: true },
          { kind: "weekly_all", percent: 52, resets_at: "2026-07-28T19:00:00Z", is_active: false },
          {
            kind: "weekly_scoped", percent: 32,
            resets_at: "2026-07-28T18:59:59Z", is_active: false,
            scope: { model: { display_name: "Fable" } },
          },
        ],
      },
    },
  }));

  expect(await readClaudePlanUsage("work")).toEqual({
    profile: "work",
    fetchedAt: 1_784_781_109_168,
    limits: [
      { kind: "session", label: "5-hour", utilization: 75, resetAt: Date.parse("2026-07-23T06:00:00Z"), active: true },
      { kind: "weekly_all", label: "Weekly", utilization: 52, resetAt: Date.parse("2026-07-28T19:00:00Z"), active: false },
      { kind: "weekly_scoped", label: "Weekly · Fable", utilization: 32, resetAt: Date.parse("2026-07-28T18:59:59Z"), active: false },
    ],
  });
});

test("falls back to named Claude usage windows and rejects malformed cache", async () => {
  await addProfile("work", "subscription");
  await writeFile(join(profileDir("work"), ".claude.json"), JSON.stringify({
    cachedUsageUtilization: {
      fetchedAtMs: 123,
      utilization: {
        five_hour: { utilization: 18, resets_at: "2026-07-23T10:00:00Z" },
        seven_day: { utilization: 41, resets_at: "invalid" },
      },
    },
  }));
  const usage = await readClaudePlanUsage("work");
  expect(usage?.limits).toEqual([
    { kind: "session", label: "5-hour", utilization: 18, resetAt: Date.parse("2026-07-23T10:00:00Z"), active: true },
    { kind: "weekly_all", label: "Weekly", utilization: 41, resetAt: null, active: false },
  ]);

  await writeFile(join(profileDir("work"), ".claude.json"), "not json");
  expect(await readClaudePlanUsage("work")).toBeNull();
});

test("prefers the newer near-realtime status-line rate limits", async () => {
  await addProfile("work", "subscription");
  await writeFile(join(profileDir("work"), ".claude.json"), JSON.stringify({
    cachedUsageUtilization: {
      fetchedAtMs: 100,
      utilization: {
        five_hour: { utilization: 10, resets_at: "2026-07-23T10:00:00Z" },
        seven_day: { utilization: 20, resets_at: "2026-07-29T10:00:00Z" },
      },
    },
  }));
  await mkdir(join(profileDir("work"), ".oreodeck"), { recursive: true });
  await writeFile(join(profileDir("work"), ".oreodeck", "rate-limits.json"), JSON.stringify({
    capturedAtMs: 200,
    fiveHour: { utilization: 31, resetAtMs: 300 },
    sevenDay: { utilization: 42, resetAtMs: 400 },
  }));
  const usage = await readClaudePlanUsage("work");
  expect(usage?.fetchedAt).toBe(200);
  expect(usage?.limits).toEqual([
    { kind: "session", label: "5-hour", utilization: 31, resetAt: 300, active: true },
    { kind: "weekly_all", label: "Weekly", utilization: 42, resetAt: 400, active: false },
  ]);
});
