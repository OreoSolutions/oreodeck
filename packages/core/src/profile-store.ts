import { mkdir, rm } from "node:fs/promises";
import { assertValidName, configPath, profileDir } from "./paths";
import { readJson, writeJsonAtomic } from "./atomic";
import { deleteApiKey } from "./keychain";

export type ProfileKind = "subscription" | "api-key";

export interface Profile {
  name: string;
  kind: ProfileKind;
}

export interface Config {
  profiles: Profile[];
  active: string | null;
  failoverEnabled: boolean;
  failoverOrder: string[];
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
  return (await readJson<Config>(configPath())) ?? {
    profiles: [],
    active: null,
    failoverEnabled: true,
    failoverOrder: [],
  };
}

export async function saveConfig(c: Config): Promise<void> {
  await writeJsonAtomic(configPath(), c);
}

export async function getProfile(name: string): Promise<Profile | null> {
  const c = await loadConfig();
  return findProfile(c.profiles, name) ?? null;
}

export async function addProfile(name: string, kind: ProfileKind): Promise<void> {
  assertValidName(name);
  const c = await loadConfig();
  if (findProfile(c.profiles, name)) {
    throw new Error(`Profile "${name}" already exists.`);
  }
  await mkdir(profileDir(name), { recursive: true });
  c.profiles.push({ name, kind });
  c.failoverOrder.push(name);
  c.active ??= name;
  await saveConfig(c);
}

export async function removeProfile(name: string): Promise<void> {
  const c = await loadConfig();
  const profile = findProfile(c.profiles, name);
  if (!profile) {
    throw new Error(`Profile "${name}" not found.`);
  }
  // Re-validate the *stored* name, not just the caller's input: config.json
  // may have been hand-edited or corrupted to contain something like
  // "../../something", which would otherwise reach rm() below.
  assertValidName(profile.name);

  // Destroy external resources (profile dir, Keychain entry) before
  // committing the config change. If either destructive step throws, the
  // profile is still listed in config.json and the operation is retryable —
  // the caller sees a failed `ccm remove` rather than a profile that
  // silently vanished from `ccm list` while its data survives as an
  // invisible orphan.
  await rm(profileDir(profile.name), { recursive: true, force: true });
  await deleteApiKey(profile.name);

  c.profiles = c.profiles.filter((p) => p.name.toLowerCase() !== profile.name.toLowerCase());
  c.failoverOrder = c.failoverOrder.filter(
    (n) => n.toLowerCase() !== profile.name.toLowerCase(),
  );
  if (c.active && c.active.toLowerCase() === profile.name.toLowerCase()) {
    c.active = c.profiles[0]?.name ?? null;
  }
  await saveConfig(c);
}

export async function setActive(name: string): Promise<void> {
  const c = await loadConfig();
  const profile = findProfile(c.profiles, name);
  if (!profile) {
    throw new Error(`Profile "${name}" not found.`);
  }
  assertValidName(profile.name);
  c.active = profile.name;
  await saveConfig(c);
}

/** Chọn profile cho một lệnh: override (-P) thắng, không thì lấy active. */
export async function resolveProfileName(override?: string): Promise<string> {
  if (override) {
    const profile = await getProfile(override);
    if (!profile) {
      throw new Error(`Profile "${override}" not found. Run \`ccm list\` to see profiles.`);
    }
    return profile.name;
  }
  const c = await loadConfig();
  if (!c.active) {
    throw new Error("No active profile. Run `ccm add <name>` to create one.");
  }
  return c.active;
}
