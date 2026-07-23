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
  await writeFile(join(root, "global", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "statusline.sh" } }));
  await writeFile(join(root, "global", "statusline.sh"), "#!/bin/sh\n");
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
  const settings = await run("shared", "set", "work", "settings.json");
  expect(settings.code).toBe(1);
  expect(settings.stderr).toContain("Allowed: mcp, skills, plugins, statusline.sh");
});

test("shared set supports the global status line without sharing settings.json", async () => {
  const result = await run("shared", "set", "work", "statusline.sh");
  expect(result.code).toBe(0);
  expect((await run("shared", "show", "work")).stdout.trim()).toBe("statusline.sh");
});

test("interactive choices disable existing local paths and missing global sources", async () => {
  await mkdir(join(root, "global", "plugins"));
  await mkdir(join(root, "ccm", "profiles", "work", "plugins"));
  const availability = await interactiveAvailability("work");
  expect(availability.disabled.has("plugins")).toBe(false);
  expect(availability.conflicts.has("plugins")).toBe(true);
  expect(availability.annotations.get("plugins")).toContain("confirmation and backup");
  expect(availability.disabled.has("skills")).toBe(false);
});

test("shared set --force --yes backs up and replaces a local resource", async () => {
  await mkdir(join(root, "global", "plugins"));
  const local = join(root, "ccm", "profiles", "work", "plugins");
  await mkdir(local);
  await writeFile(join(local, "local.txt"), "local");
  const result = await run("shared", "set", "work", "plugins", "--force", "--yes");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("backed up at");
});
