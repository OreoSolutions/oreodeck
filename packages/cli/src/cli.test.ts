import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile } from "@ccm/core";

let dir: string;

const CLI = join(import.meta.dir, "index.ts");

/** Chạy `ccm` như một tiến trình con, với CCM_HOME trỏ vào thư mục test. */
async function ccm(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, CCM_HOME: dir },
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
  dir = await mkdtemp(join(tmpdir(), "ccm-cli-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  delete process.env.OREODECK_SHELL_INTEGRATION;
  delete process.env.OREODECK_INSTALL_BIN_DIR;
  delete process.env.OREODECK_INSTALL_APP_DIR;
  delete process.env.OREODECK_ZSHRC;
  delete process.env.OREODECK_UI_PAYLOAD_DIR;
  delete process.env.OREODECK_UI_PAYLOAD;
  await rm(dir, { recursive: true, force: true });
});

test("list with no profiles prints a hint", async () => {
  const { stdout, code } = await ccm("list");
  expect(code).toBe(0);
  expect(stdout).toContain("No profiles");
});

test("list shows profiles and marks the active one", async () => {
  await addProfile("work", "subscription");
  await addProfile("bot", "api-key");
  const { stdout, code } = await ccm("list");
  expect(code).toBe(0);
  expect(stdout).toContain("work");
  expect(stdout).toContain("bot");
  expect(stdout).toContain("api-key");
  expect(stdout).toMatch(/\*\s+work/);
});

test("use switches the active profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  const { code } = await ccm("use", "personal");
  expect(code).toBe(0);
  const after = await ccm("list");
  expect(after.stdout).toMatch(/\*\s+personal/);
});

test("use --tab validates a profile without changing global active", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  process.env.OREODECK_SHELL_INTEGRATION = "1";
  const { stdout, code } = await ccm("use", "--tab", "personal");
  delete process.env.OREODECK_SHELL_INTEGRATION;
  expect(code).toBe(0);
  expect(stdout).toContain('Tab profile is now "personal"');
  const after = await ccm("list");
  expect(after.stdout).toMatch(/\*\s+work/);
});

test("use with an unknown profile exits 1 with an error", async () => {
  const { stderr, code } = await ccm("use", "ghost");
  expect(code).toBe(1);
  expect(stderr).toContain("not found");
});

// F-7: bare `ccm` should behave like `--help` (print help, exit 0), not
// commander's default "missing subcommand" path which exits 1.
test("bare OreoDeck with no args prints help and exits 0", async () => {
  const { stdout, code } = await ccm();
  expect(code).toBe(0);
  expect(stdout).toContain("Usage: oreodeck");
  expect(stdout).toContain("Commands:");
});

test("oreodeck --help still exits 0 and prints help", async () => {
  const { stdout, code } = await ccm("--help");
  expect(code).toBe(0);
  expect(stdout).toContain("Usage: oreodeck");
});

test("an unknown command still exits nonzero", async () => {
  const { stderr, code } = await ccm("bogus-command");
  expect(code).not.toBe(0);
  expect(stderr).toContain("unknown command");
});

test("uninstall removes package files and shell integration but keeps profiles", async () => {
  await addProfile("work", "subscription");
  const binDir = join(dir, "bin");
  const appDir = join(dir, "Applications");
  const zshrc = join(dir, ".zshrc");
  await mkdir(join(appDir, "OreoDeck.app"), { recursive: true });
  await mkdir(join(appDir, "OreoDeck.app.backup-20260723"), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, "oreodeck"), "binary");
  await writeFile(join(binDir, "ord"), "binary");
  await writeFile(zshrc, `before\n# >>> OreoDeck shell integration v2 >>>\nclaude() { :; }\n# <<< OreoDeck shell integration v2 <<<\nafter\n`);
  process.env.OREODECK_INSTALL_BIN_DIR = binDir;
  process.env.OREODECK_INSTALL_APP_DIR = appDir;
  process.env.OREODECK_ZSHRC = zshrc;
  process.env.OREODECK_UI_PAYLOAD_DIR = join(dir, "ui-payload");

  const { stdout, code } = await ccm("uninstall", "--yes");
  expect(code).toBe(0);
  expect(stdout).toContain("Profile data is still available");
  expect(stdout).toContain("source ~/.zshrc");
  expect(stdout).toContain("unset -f ord oreodeck claude");
  expect(stat(join(binDir, "ord"))).rejects.toThrow();
  expect(stat(join(appDir, "OreoDeck.app"))).rejects.toThrow();
  expect(stat(join(appDir, "OreoDeck.app.backup-20260723"))).rejects.toThrow();
  expect(await readFile(zshrc, "utf8")).toBe("before\nafter\n");
  expect((await stat(join(dir, "profiles", "work"))).isDirectory()).toBe(true);
});

test("ui install adds the optional app from the cached payload", async () => {
  const payload = join(dir, "payload", "OreoDeck.app");
  const appDir = join(dir, "Applications");
  await mkdir(join(payload, "Contents", "MacOS"), { recursive: true });
  await writeFile(join(payload, "Contents", "MacOS", "OreoDeck"), "app-binary");
  process.env.OREODECK_UI_PAYLOAD = payload;
  process.env.OREODECK_INSTALL_APP_DIR = appDir;

  const { stdout, code } = await ccm("ui");
  expect(code).toBe(0);
  expect(stdout).toContain("OreoDeck UI installed");
  expect(await readFile(join(appDir, "OreoDeck.app", "Contents", "MacOS", "OreoDeck"), "utf8"))
    .toBe("app-binary");
});
