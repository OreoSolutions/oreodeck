import { mkdir, rm } from "node:fs/promises";
import { configPath, profileDir } from "./paths";
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

const DEFAULT_CONFIG: Config = {
  profiles: [],
  active: null,
  failoverEnabled: true,
  failoverOrder: [],
};

/** Tên profile thành tên thư mục, nên phải chặn path traversal. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

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
  return c.profiles.find((p) => p.name === name) ?? null;
}

export async function addProfile(name: string, kind: ProfileKind): Promise<void> {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid profile name: ${JSON.stringify(name)}. Use letters, digits, - and _ (max 64 chars).`,
    );
  }
  const c = await loadConfig();
  if (c.profiles.some((p) => p.name === name)) {
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
  if (!c.profiles.some((p) => p.name === name)) {
    throw new Error(`Profile "${name}" not found.`);
  }
  c.profiles = c.profiles.filter((p) => p.name !== name);
  c.failoverOrder = c.failoverOrder.filter((n) => n !== name);
  if (c.active === name) c.active = c.profiles[0]?.name ?? null;
  await saveConfig(c);
  await rm(profileDir(name), { recursive: true, force: true });
  await deleteApiKey(name);
}

export async function setActive(name: string): Promise<void> {
  const c = await loadConfig();
  if (!c.profiles.some((p) => p.name === name)) {
    throw new Error(`Profile "${name}" not found.`);
  }
  c.active = name;
  await saveConfig(c);
}

/** Chọn profile cho một lệnh: override (-P) thắng, không thì lấy active. */
export async function resolveProfileName(override?: string): Promise<string> {
  if (override) {
    if (!(await getProfile(override))) {
      throw new Error(`Profile "${override}" not found. Run \`ccm list\` to see profiles.`);
    }
    return override;
  }
  const c = await loadConfig();
  if (!c.active) {
    throw new Error("No active profile. Run `ccm add <name>` to create one.");
  }
  return c.active;
}
