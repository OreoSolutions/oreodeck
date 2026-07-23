import { dirname, join, resolve } from "node:path";
import { lstat, mkdir, readFile, readdir, readlink, rename, symlink, unlink } from "node:fs/promises";
import { globalClaudeDir, profileDir } from "./paths";
import { loadConfig, updateConfig } from "./profile-store";
import { syncSharedConfiguration } from "./shared-config";
import { ensureGlobalBuiltinOreoDeckSkill, isManagedOreoDeckSkill } from "./builtin-skills";

export const SHARED_RESOURCES = [
  "mcp", "skills", "plugins", "statusline.sh",
] as const;

const LEGACY_SHARED_RESOURCES = [
  "CLAUDE.md", "settings.json", "statusline.sh", "agents", "commands", ...SHARED_RESOURCES,
] as const;

export type SharedResource = typeof SHARED_RESOURCES[number];

function validateResources(resources: string[]): SharedResource[] {
  const unique: SharedResource[] = [];
  for (const resource of resources) {
    if (!(SHARED_RESOURCES as readonly string[]).includes(resource)) {
      throw new Error(`Unsupported shared resource "${resource}". Allowed: ${SHARED_RESOURCES.join(", ")}.`);
    }
    if (!unique.includes(resource as SharedResource)) unique.push(resource as SharedResource);
  }
  return unique;
}

function validateStoredResources(resources: string[]): string[] {
  const unique: string[] = [];
  for (const resource of resources) {
    if (!(LEGACY_SHARED_RESOURCES as readonly string[]).includes(resource)) {
      throw new Error(`Unsupported stored shared resource "${resource}".`);
    }
    if (!unique.includes(resource)) unique.push(resource);
  }
  return unique;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function isExpectedLink(destination: string, source: string): Promise<boolean> {
  const info = await lstat(destination);
  if (!info.isSymbolicLink()) return false;
  const target = await readlink(destination);
  return resolve(dirname(destination), target) === source;
}

async function containsOnlyManagedOreoDeckSkill(path: string): Promise<boolean> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) return false;
  const entries = await readdir(path);
  if (entries.length !== 1 || entries[0] !== "oreodeck") return false;
  try {
    return isManagedOreoDeckSkill(await readFile(join(path, "oreodeck", "SKILL.md"), "utf8"));
  } catch {
    return false;
  }
}

/** Sets the complete safe-resource list for one profile. Existing real files
 * are never overwritten; only links pointing to the expected global source
 * are removed. Filesystem changes are rolled back if config persistence fails. */
export async function setSharedResources(
  profileName: string,
  requested: string[],
  options: { force?: boolean } = {},
): Promise<string | null> {
  const resources = validateResources(requested);
  const created: Array<{ destination: string }> = [];
  const removed: Array<{ source: string; destination: string }> = [];
  const displaced: Array<{ destination: string; backup: string }> = [];
  let backupRoot: string | null = null;
  try {
    await updateConfig(async (config) => {
    const profile = config.profiles.find((p) => p.name.toLowerCase() === profileName.toLowerCase());
    if (!profile) throw new Error(`Profile "${profileName}" not found.`);
    const old = validateStoredResources(profile.sharedResources ?? []);
    const globalRoot = globalClaudeDir();
      for (const resource of resources.filter((r) => !old.includes(r) && r !== "mcp")) {
        const source = join(globalRoot, resource);
        const destination = join(profileDir(profile.name), resource);
        if (resource === "skills") await ensureGlobalBuiltinOreoDeckSkill();
        if (!(await exists(source))) throw new Error(`Global Claude resource does not exist: ~/.claude/${resource}`);
        if (await exists(destination)) {
          if (await isExpectedLink(destination, source)) continue;
          const isManagedSkillsDirectory = resource === "skills"
            && await containsOnlyManagedOreoDeckSkill(destination);
          if (!options.force && !isManagedSkillsDirectory) {
            throw new Error(`Profile resource already exists and will not be overwritten: ${destination}`);
          }
          backupRoot ??= join(profileDir(profile.name), ".oreodeck-backups", "shared", `${Date.now()}-${process.pid}`);
          const backup = join(backupRoot, resource);
          await mkdir(dirname(backup), { recursive: true });
          await rename(destination, backup);
          displaced.push({ destination, backup });
        }
        await symlink(source, destination);
        created.push({ destination });
      }
      for (const resource of old.filter(
        (r) => !(resources as readonly string[]).includes(r) && r !== "mcp",
      )) {
        const source = join(globalRoot, resource);
        const destination = join(profileDir(profile.name), resource);
        if (!(await exists(destination))) continue;
        if (!(await isExpectedLink(destination, source))) {
          throw new Error(`Profile resource is not an OreoDeck-managed symlink: ${destination}`);
        }
        await unlink(destination);
        removed.push({ source, destination });
      }
      profile.sharedResources = resources;
      await syncSharedConfiguration(profile.name, resources);
    });
  } catch (error) {
    for (const item of created.reverse()) await unlink(item.destination).catch(() => {});
    for (const item of displaced.reverse()) await rename(item.backup, item.destination).catch(() => {});
    for (const item of removed.reverse()) await symlink(item.source, item.destination).catch(() => {});
    throw error;
  }
  return backupRoot;
}

export async function getSharedResources(profileName: string): Promise<string[]> {
  const config = await loadConfig();
  const profile = config.profiles.find((p) => p.name.toLowerCase() === profileName.toLowerCase());
  if (!profile) throw new Error(`Profile "${profileName}" not found.`);
  return [...(profile.sharedResources ?? [])];
}
