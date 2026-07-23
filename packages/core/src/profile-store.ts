import { mkdir, rm } from "node:fs/promises";
import { assertValidName, configLockPath, configPath, profileDir } from "./paths";
import { readJson, withDirectoryLock, writeJsonAtomic } from "./atomic";
import { deleteApiKey } from "./keychain";
import { ensureBuiltinOreoDeckSkill } from "./builtin-skills";

export type ProfileKind = "subscription" | "api-key";

export interface Profile {
  name: string;
  kind: ProfileKind;
  sharedResources?: string[];
}

export interface Config {
  profiles: Profile[];
  active: string | null;
  failoverEnabled: boolean;
  failoverOrder: string[];
  terminal?: "terminal" | "ghostty" | "iterm2" | "wezterm" | "alacritty" | "kitty" |
    "warp" | "hyper" | "tabby" | "rio" | "wave";
}

export type ProfileSelectionSource = "explicit" | "project" | "tab" | "global";

export interface ResolvedProfileSelection {
  name: string;
  source: ProfileSelectionSource;
  projectConfigPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime half of the TS/Rust disk contract. Type assertions alone do not
 * protect the CLI from valid JSON with the wrong shape. Unknown fields remain
 * on the original object and therefore survive writes for forward compatibility. */
export function validateConfig(value: unknown): Config {
  if (!isRecord(value) || !Array.isArray(value.profiles) || !Array.isArray(value.failoverOrder)) {
    throw new Error("The OreoDeck config file has an invalid structure and could not be read.");
  }
  if (typeof value.failoverEnabled !== "boolean" ||
      !(value.active === null || typeof value.active === "string")) {
    throw new Error("The OreoDeck config file has an invalid structure and could not be read.");
  }
  for (const profile of value.profiles) {
    if (!isRecord(profile) || typeof profile.name !== "string" ||
        (profile.kind !== "subscription" && profile.kind !== "api-key")) {
      throw new Error("The OreoDeck config file has an invalid structure and could not be read.");
    }
    if (profile.sharedResources !== undefined &&
        (!Array.isArray(profile.sharedResources) ||
         !profile.sharedResources.every((item) => typeof item === "string"))) {
      throw new Error("The OreoDeck config file has an invalid structure and could not be read.");
    }
  }
  if (!value.failoverOrder.every((name) => typeof name === "string")) {
    throw new Error("The OreoDeck config file has an invalid structure and could not be read.");
  }
  if (value.terminal !== undefined &&
      value.terminal !== "terminal" && value.terminal !== "ghostty" && value.terminal !== "iterm2" &&
      value.terminal !== "wezterm" && value.terminal !== "alacritty" && value.terminal !== "kitty" &&
      value.terminal !== "warp" && value.terminal !== "hyper" && value.terminal !== "tabby" &&
      value.terminal !== "rio" && value.terminal !== "wave") {
    throw new Error("The OreoDeck config file has an invalid terminal setting.");
  }
  return value as unknown as Config;
}

/**
 * APFS (macOS) mặc định case-insensitive, nên "work" và "Work" trỏ vào
 * cùng một thư mục trên đĩa. So khớp tên profile phải case-insensitive ở
 * mọi nơi để tránh việc addProfile tạo ra hai entry config cùng chia một
 * thư mục, và để `ccm use Work` tìm thấy profile lưu là "work".
 */
function findProfile(profiles: Profile[], name: string): Profile | undefined {
  const lower = name.toLowerCase();
  return profiles.find((p) => p.name.toLowerCase() === lower);
}

export async function loadConfig(): Promise<Config> {
  const raw = await readJson<unknown>(configPath());
  return raw === null ? {
    profiles: [],
    active: null,
    failoverEnabled: true,
    failoverOrder: [],
  } : validateConfig(raw);
}

export async function saveConfig(c: Config): Promise<void> {
  await writeJsonAtomic(configPath(), c);
}

export async function updateConfig<T>(mutate: (config: Config) => Promise<T> | T): Promise<T> {
  return withDirectoryLock(configLockPath(), async () => {
    const config = await loadConfig();
    const result = await mutate(config);
    await saveConfig(config);
    return result;
  });
}

export async function getProfile(name: string): Promise<Profile | null> {
  const c = await loadConfig();
  return findProfile(c.profiles, name) ?? null;
}

export async function addProfile(name: string, kind: ProfileKind): Promise<void> {
  assertValidName(name);
  await updateConfig(async (c) => {
    if (findProfile(c.profiles, name)) throw new Error(`Profile "${name}" already exists.`);
    await mkdir(profileDir(name), { recursive: true });
    await ensureBuiltinOreoDeckSkill(name);
    c.profiles.push({ name, kind });
    c.failoverOrder.push(name);
    c.active ??= name;
  });
}

export async function removeProfile(name: string): Promise<void> {
  const initial = await loadConfig();
  const stored = findProfile(initial.profiles, name);
  if (!stored) throw new Error(`Profile "${name}" not found.`);
  // Re-validate the *stored* name, not just the caller's input: config.json
  // may have been hand-edited or corrupted to contain something like
  // "../../something", which would otherwise reach rm() below.
  assertValidName(stored.name);

  // Destroy external resources (profile dir, Keychain entry) before
  // committing the config change. If either destructive step throws, the
  // profile is still listed in config.json and the operation is retryable —
  // the caller sees a failed `ccm remove` rather than a profile that
  // silently vanished from `ccm list` while its data survives as an
  // invisible orphan.
  await rm(profileDir(stored.name), { recursive: true, force: true });
  await deleteApiKey(stored.name);

  await updateConfig((c) => {
    const profile = findProfile(c.profiles, stored.name);
    if (!profile) throw new Error(`Profile "${stored.name}" not found.`);
    c.profiles = c.profiles.filter((p) => p.name.toLowerCase() !== profile.name.toLowerCase());
    c.failoverOrder = c.failoverOrder.filter((n) => n.toLowerCase() !== profile.name.toLowerCase());
    if (c.active && c.active.toLowerCase() === profile.name.toLowerCase()) {
      c.active = c.profiles[0]?.name ?? null;
    }
  });
}

export async function setActive(name: string): Promise<void> {
  await updateConfig((c) => {
    const profile = findProfile(c.profiles, name);
    if (!profile) throw new Error(`Profile "${name}" not found.`);
    assertValidName(profile.name);
    c.active = profile.name;
  });
}

/** Chọn profile: override (-P) > project .oreodeck > tab > active toàn cục. */
export async function resolveProfileSelection(
  override?: string,
  cwd = process.cwd(),
): Promise<ResolvedProfileSelection> {
  const projectProfilePromise = override
    ? Promise.resolve(null)
    : (await import("./project-config")).findProjectProfile(cwd);
  const projectProfile = await projectProfilePromise;
  const tabProfile = process.env.OREODECK_PROFILE?.trim();
  const requested = override || projectProfile?.profile || tabProfile;
  if (requested) {
    const profile = await getProfile(requested);
    if (!profile) {
      throw new Error(`Profile "${requested}" not found. Run \`oreodeck list\` to see profiles.`);
    }
    return {
      name: profile.name,
      source: override ? "explicit" : projectProfile ? "project" : "tab",
      ...(projectProfile ? { projectConfigPath: projectProfile.path } : {}),
    };
  }
  const c = await loadConfig();
  if (!c.active) {
    throw new Error("No active profile. Run `oreodeck add <name>` to create one.");
  }
  return { name: c.active, source: "global" };
}

export async function resolveProfileName(override?: string, cwd = process.cwd()): Promise<string> {
  return (await resolveProfileSelection(override, cwd)).name;
}
