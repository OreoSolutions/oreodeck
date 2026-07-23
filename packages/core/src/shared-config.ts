import { dirname, join } from "node:path";
import { readJson, writeJsonAtomic } from "./atomic";
import { globalClaudeDir, profileDir } from "./paths";

type JsonObject = Record<string, unknown>;
type SavedValue = { present: boolean; value?: unknown };
type SharedState = { settings?: Record<string, SavedValue>; claudeJson?: Record<string, SavedValue> };

const SETTINGS_KEYS: Record<string, readonly string[]> = {
  plugins: ["enabledPlugins", "extraKnownMarketplaces"],
  "statusline.sh": ["statusLine"],
};
const STATE_FILE = ".oreodeck-shared-state.json";

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

async function syncFile(
  sourcePath: string,
  destinationPath: string,
  state: Record<string, SavedValue>,
  enabledKeys: Set<string>,
): Promise<void> {
  const source = object(await readJson<unknown>(sourcePath));
  const destination = object(await readJson<unknown>(destinationPath));
  const managedKeys = new Set([...Object.keys(state), ...enabledKeys]);
  for (const key of managedKeys) {
    if (enabledKeys.has(key)) {
      state[key] ??= Object.prototype.hasOwnProperty.call(destination, key)
        ? { present: true, value: destination[key] }
        : { present: false };
      if (Object.prototype.hasOwnProperty.call(source, key)) destination[key] = source[key];
      else delete destination[key];
    } else if (state[key]) {
      const saved = state[key]!;
      if (saved.present) destination[key] = saved.value;
      else delete destination[key];
      delete state[key];
    }
  }
  await writeJsonAtomic(destinationPath, destination);
}

/** Refresh configuration-backed shared resources without sharing the whole
 * settings/auth files. Original profile values are restored when disabled. */
export async function syncSharedConfiguration(profileName: string, resources: readonly string[]): Promise<void> {
  const root = profileDir(profileName);
  const statePath = join(root, STATE_FILE);
  const state = object(await readJson<unknown>(statePath)) as SharedState;
  state.settings ??= {};
  state.claudeJson ??= {};

  const settingsKeys = new Set<string>();
  for (const resource of resources) {
    for (const key of SETTINGS_KEYS[resource] ?? []) settingsKeys.add(key);
  }
  // Legacy whole-file sharing already exposes every key through its symlink.
  // Never rewrite that symlink while refreshing selective resources.
  if (!resources.includes("settings.json")) {
    await syncFile(
      join(globalClaudeDir(), "settings.json"),
      join(root, "settings.json"),
      state.settings,
      settingsKeys,
    );
  }
  await syncFile(
    join(dirname(globalClaudeDir()), ".claude.json"),
    join(root, ".claude.json"),
    state.claudeJson,
    new Set(resources.includes("mcp") ? ["mcpServers"] : []),
  );
  await writeJsonAtomic(statePath, state);
}
