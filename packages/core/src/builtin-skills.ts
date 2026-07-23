import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import oreoDeckSkill from "../../../assets/claude-skills/oreodeck/SKILL.md" with { type: "text" };
import { globalClaudeDir, profileDir } from "./paths";
import type { Profile } from "./profile-store";

const MANAGED_MARKER = "<!-- managed-by: oreodeck -->";

export type BuiltinSkillInstallResult = "created" | "updated" | "unchanged" | "conflict";

async function ensureBuiltinOreoDeckSkillAt(path: string): Promise<BuiltinSkillInstallResult> {
  let current: string | null = null;
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (current === oreoDeckSkill) return "unchanged";
  if (current !== null && !current.includes(MANAGED_MARKER)) return "conflict";

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, oreoDeckSkill, { mode: 0o644 });
  return current === null ? "created" : "updated";
}

/** Install the built-in Claude skill without overwriting a user-owned skill
 * that happens to use the same name. Managed copies are kept up to date. */
export async function ensureBuiltinOreoDeckSkill(profileName: string): Promise<BuiltinSkillInstallResult> {
  return ensureBuiltinOreoDeckSkillAt(join(profileDir(profileName), "skills", "oreodeck", "SKILL.md"));
}

export async function ensureGlobalBuiltinOreoDeckSkill(): Promise<BuiltinSkillInstallResult> {
  return ensureBuiltinOreoDeckSkillAt(join(globalClaudeDir(), "skills", "oreodeck", "SKILL.md"));
}

export function isManagedOreoDeckSkill(content: string): boolean {
  return content.includes(MANAGED_MARKER);
}

/** Best-effort migration for existing profiles. A damaged or read-only
 * profile must not make unrelated CLI commands unusable. `ord run` still
 * performs a strict sync for the selected profile before launching Claude. */
export async function ensureBuiltinSkillsForProfiles(
  profiles: readonly Pick<Profile, "name">[],
): Promise<void> {
  await Promise.all(profiles.map(async (profile) => {
    try {
      await ensureBuiltinOreoDeckSkill(profile.name);
    } catch {
      // Strict installation happens in buildEnv for the profile being used.
    }
  }));
}
