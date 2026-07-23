import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile } from "./profile-store";
import { profileDir } from "./paths";
import { ensureUsageStatuslineProxy } from "./statusline-proxy";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "oreodeck-rate-proxy-"));
  process.env.OREODECK_HOME = root;
  await addProfile("work", "subscription");
});

afterEach(async () => {
  delete process.env.OREODECK_HOME;
  await rm(root, { recursive: true, force: true });
});

test("captures live rate limits and preserves the original status-line output", async () => {
  const original = join(root, "original.sh");
  await writeFile(original, "#!/bin/sh\ncat >/dev/null\nprintf 'original status\\n'\n");
  await chmod(original, 0o755);
  await writeFile(join(profileDir("work"), "settings.json"), JSON.stringify({
    theme: "dark",
    statusLine: { type: "command", command: `'${original}'`, padding: 2 },
  }));

  await ensureUsageStatuslineProxy("work");
  const settings = JSON.parse(await readFile(join(profileDir("work"), "settings.json"), "utf8"));
  expect(settings.theme).toBe("dark");
  expect(settings.statusLine.padding).toBe(2);
  expect(settings.statusLine.command).toContain("statusline-proxy.py");

  const proxy = join(profileDir("work"), ".oreodeck", "statusline-proxy.py");
  const process = Bun.spawn([proxy], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  process.stdin.write(JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: 1_738_425_600 },
      seven_day: { used_percentage: 41.2, resets_at: 1_738_857_600 },
    },
  }));
  process.stdin.end();
  expect(await new Response(process.stdout).text()).toBe("original status\n");
  expect(await process.exited).toBe(0);

  const cache = JSON.parse(await readFile(
    join(profileDir("work"), ".oreodeck", "rate-limits.json"),
    "utf8",
  ));
  expect(cache.fiveHour).toEqual({ utilization: 23.5, resetAtMs: 1_738_425_600_000 });
  expect(cache.sevenDay).toEqual({ utilization: 41.2, resetAtMs: 1_738_857_600_000 });
  expect(typeof cache.capturedAtMs).toBe("number");
});

test("does not replace malformed profile settings", async () => {
  const path = join(profileDir("work"), "settings.json");
  await writeFile(path, "not json");
  await expect(ensureUsageStatuslineProxy("work")).rejects.toBeInstanceOf(SyntaxError);
  expect(await readFile(path, "utf8")).toBe("not json");
});
