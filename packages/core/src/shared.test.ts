import { afterEach, beforeEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile, loadConfig } from "./profile-store";
import { getSharedResources, setSharedResources } from "./shared";
import { profileDir } from "./paths";

let root: string;
let globalRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ccm-shared-"));
  globalRoot = join(root, "global-claude");
  process.env.CCM_HOME = join(root, "ccm");
  process.env.CCM_GLOBAL_CLAUDE_HOME = globalRoot;
  await mkdir(join(globalRoot, "skills"), { recursive: true });
  await writeFile(join(globalRoot, "CLAUDE.md"), "global instructions");
  await addProfile("work", "subscription");
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  delete process.env.CCM_GLOBAL_CLAUDE_HOME;
  await rm(root, { recursive: true, force: true });
});

test("configures selected global resources as per-profile symlinks", async () => {
  await setSharedResources("work", ["skills", "CLAUDE.md"]);
  expect((await lstat(join(profileDir("work"), "skills"))).isSymbolicLink()).toBe(true);
  expect(await readlink(join(profileDir("work"), "CLAUDE.md"))).toBe(join(globalRoot, "CLAUDE.md"));
  expect(await getSharedResources("WORK")).toEqual(["skills", "CLAUDE.md"]);
  expect((await loadConfig()).profiles[0]?.sharedResources).toEqual(["skills", "CLAUDE.md"]);
});

test("clearing removes only ccm-managed symlinks", async () => {
  await setSharedResources("work", ["skills"]);
  await setSharedResources("work", []);
  await expect(lstat(join(profileDir("work"), "skills"))).rejects.toThrow();
  expect(await getSharedResources("work")).toEqual([]);
});

test("never overwrites a real profile resource", async () => {
  await mkdir(join(profileDir("work"), "skills"));
  await expect(setSharedResources("work", ["skills"])).rejects.toThrow("will not be overwritten");
  expect((await lstat(join(profileDir("work"), "skills"))).isDirectory()).toBe(true);
});

test("force backs up a real profile resource before replacing it with a symlink", async () => {
  const local = join(profileDir("work"), "skills");
  await mkdir(local);
  await writeFile(join(local, "local.txt"), "keep me");
  const backup = await setSharedResources("work", ["skills"], { force: true });
  expect(backup).not.toBeNull();
  expect((await lstat(local)).isSymbolicLink()).toBe(true);
  expect(await Bun.file(join(backup!, "skills", "local.txt")).text()).toBe("keep me");
});

test("rejects resources outside the security allowlist", async () => {
  await expect(setSharedResources("work", ["projects"])).rejects.toThrow("Unsupported shared resource");
});

test("shares plugin activation and MCP config without replacing isolated config files", async () => {
  await mkdir(globalRoot, { recursive: true });
  await writeFile(join(globalRoot, "settings.json"), JSON.stringify({ enabledPlugins: { "demo@market": true }, theme: "dark" }));
  await writeFile(join(root, ".claude.json"), JSON.stringify({ mcpServers: { docs: { command: "docs" } }, oauthAccount: "global-secret" }));
  await mkdir(join(globalRoot, "plugins"), { recursive: true });
  await writeFile(join(profileDir("work"), "settings.json"), JSON.stringify({ theme: "light" }));
  await writeFile(join(profileDir("work"), ".claude.json"), JSON.stringify({ oauthAccount: "profile-secret" }));
  await setSharedResources("work", ["plugins", "mcp"]);
  const settings = JSON.parse(await readFile(join(profileDir("work"), "settings.json"), "utf8"));
  const state = JSON.parse(await readFile(join(profileDir("work"), ".claude.json"), "utf8"));
  expect(settings).toEqual({ theme: "light", enabledPlugins: { "demo@market": true } });
  expect(state).toEqual({ oauthAccount: "profile-secret", mcpServers: { docs: { command: "docs" } } });
  await setSharedResources("work", []);
  expect(JSON.parse(await readFile(join(profileDir("work"), "settings.json"), "utf8"))).toEqual({ theme: "light" });
  expect(JSON.parse(await readFile(join(profileDir("work"), ".claude.json"), "utf8"))).toEqual({ oauthAccount: "profile-secret" });
});
