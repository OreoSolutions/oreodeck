import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnv } from "./launcher";
import { profileDir } from "./paths";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-launch-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

test("buildEnv points CLAUDE_CONFIG_DIR at the profile dir", async () => {
  const env = await buildEnv({ name: "work", kind: "subscription" }, null, {});
  expect(env.CLAUDE_CONFIG_DIR).toBe(profileDir("work"));
});

test("buildEnv injects ANTHROPIC_API_KEY for api-key profiles", async () => {
  const env = await buildEnv({ name: "bot", kind: "api-key" }, "sk-ant-x", {});
  expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-x");
});

test("buildEnv strips an inherited ANTHROPIC_API_KEY for subscription profiles", async () => {
  const env = await buildEnv(
    { name: "work", kind: "subscription" },
    null,
    { ANTHROPIC_API_KEY: "sk-ant-leaked" },
  );
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
});

test("buildEnv preserves unrelated env vars", async () => {
  const env = await buildEnv({ name: "work", kind: "subscription" }, null, { PATH: "/usr/bin" });
  expect(env.PATH).toBe("/usr/bin");
});
