import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "./atomic";
import { profileDir } from "./paths";

const MANAGED_MARKER = "# managed-by: oreodeck-rate-limits";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function proxyScript(): string {
  return `#!/usr/bin/env python3
${MANAGED_MARKER}
import json, os, subprocess, sys, tempfile, time

root = os.path.dirname(os.path.abspath(__file__))
cache_path = os.path.join(root, "rate-limits.json")
config_path = os.path.join(root, "statusline-original.json")
raw = sys.stdin.read()

try:
    payload = json.loads(raw)
    limits = payload.get("rate_limits") or {}
    result = {"capturedAtMs": int(time.time() * 1000)}
    for source, target in (("five_hour", "fiveHour"), ("seven_day", "sevenDay")):
        value = limits.get(source)
        if isinstance(value, dict) and isinstance(value.get("used_percentage"), (int, float)):
            window = {"utilization": value["used_percentage"]}
            if isinstance(value.get("resets_at"), (int, float)):
                window["resetAtMs"] = int(value["resets_at"] * 1000)
            result[target] = window
    if "fiveHour" in result or "sevenDay" in result:
        fd, temporary = tempfile.mkstemp(prefix=".rate-limits-", dir=root)
        with os.fdopen(fd, "w") as handle:
            json.dump(result, handle, separators=(",", ":"))
            handle.write("\\n")
        os.replace(temporary, cache_path)
except Exception:
    pass

try:
    with open(config_path) as handle:
        original = json.load(handle).get("original")
    command = original.get("command") if isinstance(original, dict) else None
    if isinstance(command, str) and command:
        completed = subprocess.run(command, shell=True, input=raw, text=True, capture_output=True)
        sys.stdout.write(completed.stdout)
        sys.stderr.write(completed.stderr)
        raise SystemExit(completed.returncode)
except FileNotFoundError:
    pass
except Exception as error:
    sys.stderr.write(str(error) + "\\n")
`;
}

/** Wrap a profile's status line so Claude's live `rate_limits` are captured
 * without changing the visible output or reading OAuth credentials. */
export async function ensureUsageStatuslineProxy(profileName: string): Promise<void> {
  const root = join(profileDir(profileName), ".oreodeck");
  const scriptPath = join(root, "statusline-proxy.py");
  const originalPath = join(root, "statusline-original.json");
  const settingsPath = join(profileDir(profileName), "settings.json");
  const wrapperCommand = shellQuote(scriptPath);
  await mkdir(root, { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const value = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
    if (isRecord(value)) settings = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const current = isRecord(settings.statusLine) ? settings.statusLine : null;
  const alreadyWrapped = current?.command === wrapperCommand;
  if (!alreadyWrapped) {
    await writeJsonAtomic(originalPath, { original: current });
    settings.statusLine = {
      ...(current ?? {}),
      type: "command",
      command: wrapperCommand,
    };
    await writeJsonAtomic(settingsPath, settings);
  }

  const content = proxyScript();
  let existing = "";
  try { existing = await readFile(scriptPath, "utf8"); } catch {}
  if (existing !== content) await writeFile(scriptPath, content, { mode: 0o755 });
  await chmod(scriptPath, 0o755);
}
