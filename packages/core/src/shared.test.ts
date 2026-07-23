import { afterEach, beforeEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile, loadConfig, updateConfig } from "./profile-store";
import { getSharedResources, setSharedResources } from "./shared";
import { syncSharedConfiguration } from "./shared-config";
import { profileDir } from "./paths";

let root: string;
let globalRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ccm-shared-"));
  globalRoot = join(root, "global-claude");
  process.env.CCM_HOME = join(root, "ccm");
  process.env.CCM_GLOBAL_CLAUDE_HOME = globalRoot;
  await mkdir(join(globalRoot, "skills"), { recursive: true });
  await addProfile("work", "subscription");
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  delete process.env.CCM_GLOBAL_CLAUDE_HOME;
  await rm(root, { recursive: true, force: true });
});

test("configures selected global resources as per-profile symlinks", async () => {
  await mkdir(join(globalRoot, "plugins"), { recursive: true });
  await setSharedResources("work", ["skills", "plugins"]);
  expect((await lstat(join(profileDir("work"), "skills"))).isSymbolicLink()).toBe(true);
  expect(await readlink(join(profileDir("work"), "plugins"))).toBe(join(globalRoot, "plugins"));
  expect(await getSharedResources("WORK")).toEqual(["skills", "plugins"]);
  expect((await loadConfig()).profiles[0]?.sharedResources).toEqual(["skills", "plugins"]);
});

test("clearing removes only ccm-managed symlinks", async () => {
  await setSharedResources("work", ["skills"]);
  await setSharedResources("work", []);
  await expect(lstat(join(profileDir("work"), "skills"))).rejects.toThrow();
  expect(await getSharedResources("work")).toEqual([]);
});

test("never overwrites a real profile resource", async () => {
  await rm(join(profileDir("work"), "skills"), { recursive: true });
  await mkdir(join(profileDir("work"), "skills"));
  await writeFile(join(profileDir("work"), "skills", "custom.md"), "user-owned");
  await expect(setSharedResources("work", ["skills"])).rejects.toThrow("will not be overwritten");
  expect((await lstat(join(profileDir("work"), "skills"))).isDirectory()).toBe(true);
});

test("force backs up a real profile resource before replacing it with a symlink", async () => {
  const local = join(profileDir("work"), "skills");
  await rm(local, { recursive: true });
  await mkdir(local);
  await writeFile(join(local, "local.txt"), "keep me");
  const backup = await setSharedResources("work", ["skills"], { force: true });
  expect(backup).not.toBeNull();
  expect((await lstat(local)).isSymbolicLink()).toBe(true);
  expect(await Bun.file(join(backup!, "skills", "local.txt")).text()).toBe("keep me");
});

test("rejects resources outside the security allowlist", async () => {
  await expect(setSharedResources("work", ["projects"])).rejects.toThrow("Unsupported shared resource");
  await expect(setSharedResources("work", ["settings.json"])).rejects.toThrow("Unsupported shared resource");
  await expect(setSharedResources("work", ["CLAUDE.md"])).rejects.toThrow("Unsupported shared resource");
});

test("shares the status line script and only its settings field", async () => {
  await mkdir(globalRoot, { recursive: true });
  await writeFile(join(globalRoot, "statusline.sh"), "#!/bin/sh\necho global\n");
  await writeFile(join(globalRoot, "settings.json"), JSON.stringify({
    statusLine: { type: "command", command: "~/.claude/statusline.sh" },
    theme: "global",
  }));
  await writeFile(join(profileDir("work"), "settings.json"), JSON.stringify({ theme: "profile" }));

  await setSharedResources("work", ["statusline.sh"]);
  expect((await lstat(join(profileDir("work"), "statusline.sh"))).isSymbolicLink()).toBe(true);
  expect(JSON.parse(await readFile(join(profileDir("work"), "settings.json"), "utf8"))).toEqual({
    theme: "profile",
    statusLine: { type: "command", command: "~/.claude/statusline.sh" },
  });

  await setSharedResources("work", []);
  expect(JSON.parse(await readFile(join(profileDir("work"), "settings.json"), "utf8"))).toEqual({ theme: "profile" });
});

test("removes legacy shared resources while accepting only the narrowed allowlist", async () => {
  const source = join(globalRoot, "CLAUDE.md");
  const destination = join(profileDir("work"), "CLAUDE.md");
  await writeFile(source, "legacy global instructions");
  await symlink(source, destination);
  await updateConfig((config) => {
    config.profiles[0]!.sharedResources = ["CLAUDE.md", "skills"];
  });

  await setSharedResources("work", ["skills"]);

  await expect(lstat(destination)).rejects.toThrow();
  expect(await getSharedResources("work")).toEqual(["skills"]);
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

test("automatically adds a newly configured global Exa MCP server on refresh", async () => {
  await writeFile(
    join(root, ".claude.json"),
    JSON.stringify({ mcpServers: { docs: { command: "docs" } }, oauthAccount: "global-secret" }),
  );
  await writeFile(
    join(profileDir("work"), ".claude.json"),
    JSON.stringify({ oauthAccount: "profile-secret" }),
  );
  await setSharedResources("work", ["mcp"]);

  await writeFile(
    join(root, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        docs: { command: "docs" },
        exa: { type: "http", url: "https://example.invalid/exa-mcp" },
      },
      oauthAccount: "global-secret",
    }),
  );
  await syncSharedConfiguration("work", ["mcp"]);

  const profileState = JSON.parse(
    await readFile(join(profileDir("work"), ".claude.json"), "utf8"),
  );
  expect(profileState.mcpServers.exa).toEqual({
    type: "http",
    url: "https://example.invalid/exa-mcp",
  });
  expect(profileState.oauthAccount).toBe("profile-secret");
  expect(JSON.stringify(profileState)).not.toContain("global-secret");
});
