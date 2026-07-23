import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { writeJsonAtomic } from "./atomic";
import { ccmHome } from "./paths";
import { getProfile } from "./profile-store";

export interface ProjectProfileConfig {
  profile: string;
}

export interface LocatedProjectProfile extends ProjectProfileConfig {
  path: string;
}

export const PROJECT_CONFIG_RELATIVE_PATH = join(".oreodeck", "config.json");

/** Find the nearest project config from cwd upward. The global OreoDeck data
 * directory at ~/.oreodeck is explicitly skipped despite sharing the name. */
export async function findProjectProfile(startDirectory = process.cwd()): Promise<LocatedProjectProfile | null> {
  let directory = resolve(startDirectory);
  const globalConfig = resolve(join(ccmHome(), "config.json"));
  const home = resolve(homedir());
  for (;;) {
    if (directory === home) return null;
    const path = join(directory, PROJECT_CONFIG_RELATIVE_PATH);
    if (resolve(path) !== globalConfig) {
      try {
        const value = JSON.parse(await readFile(path, "utf8")) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)
          || typeof (value as Record<string, unknown>).profile !== "string"
          || !(value as Record<string, unknown>).profile) {
          throw new Error(`Project config ${path} must contain a non-empty "profile" string.`);
        }
        return { path, profile: (value as ProjectProfileConfig).profile };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) return null;
    directory = parent;
  }
}

/** Store canonical profile casing in the current project's local config. */
export async function setProjectProfile(name: string, directory = process.cwd()): Promise<string> {
  const profile = await getProfile(name);
  if (!profile) throw new Error(`Profile "${name}" not found.`);
  const path = join(resolve(directory), PROJECT_CONFIG_RELATIVE_PATH);
  if (resolve(path) === resolve(join(ccmHome(), "config.json"))) {
    throw new Error("Cannot create a project profile config in the OreoDeck data directory's parent.");
  }
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, { profile: profile.name });
  return path;
}
