import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile } from "@ccm/core";
import { interactiveAvailability } from "./commands/shared";

let root: string;
const CLI = join(import.meta.dir, "index.ts");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ccm-shared-cli-"));
  process.env.CCM_HOME = join(root, "ccm");
  process.env.CCM_GLOBAL_CLAUDE_HOME = join(root, "global");
  await mkdir(join(root, "global", "skills"), { recursive: true });
  await addProfile("work", "subscription");
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  delete process.env.CCM_GLOBAL_CLAUDE_HOME;
  await rm(root, { recursive: true, force: true });
});

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env }, stdout: "pipe", stderr: "pipe",
  });
  return {
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
    code: await proc.exited,
  };
}

test("shared set/show/clear configures one profile", async () => {
  expect((await run("shared", "set", "work", "skills")).code).toBe(0);
  expect((await run("shared", "show", "work")).stdout.trim()).toBe("skills");
  expect((await run("shared", "clear", "work")).code).toBe(0);
  expect((await run("shared", "show", "work")).stdout).toContain("No global Claude resources");
});

test("shared set rejects sensitive resources", async () => {
  const result = await run("shared", "set", "work", "projects");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Unsupported shared resource");
});

test("interactive choices disable existing local paths and missing global sources", async () => {
  await writeFile(join(root, "global", "settings.json"), "{}");
  await writeFile(join(root, "ccm", "profiles", "work", "settings.json"), "{}");
  const availability = await interactiveAvailability("work");
  expect(availability.disabled.has("settings.json")).toBe(false);
  expect(availability.conflicts.has("settings.json")).toBe(true);
  expect(availability.annotations.get("settings.json")).toContain("confirmation and backup");
  expect(availability.disabled.has("CLAUDE.md")).toBe(true);
  expect(availability.disabled.has("skills")).toBe(false);
});

test("shared set --force --yes backs up and replaces a local resource", async () => {
  await writeFile(join(root, "global", "settings.json"), "global");
  const local = join(root, "ccm", "profiles", "work", "settings.json");
  await writeFile(local, "local");
  const result = await run("shared", "set", "work", "settings.json", "--force", "--yes");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("backed up at");
});
