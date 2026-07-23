import {
  getSharedResources, setSharedResources, SHARED_RESOURCES, globalClaudeDir, profileDir,
} from "@ccm/core";
import { promptCheckboxes } from "../checkbox";
import { lstat, readlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promptConfirm } from "../prompt";

export async function interactiveAvailability(name: string) {
  const disabled = new Set<string>();
  const conflicts = new Set<string>();
  const annotations = new Map<string, string>();
  for (const resource of SHARED_RESOURCES) {
    const source = resource === "mcp"
      ? join(dirname(globalClaudeDir()), ".claude.json")
      : join(globalClaudeDir(), resource);
    if (resource === "mcp") {
      try {
        await lstat(source);
        annotations.set(resource, "shares only mcpServers; login and profile state remain private");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        disabled.add(resource);
        annotations.set(resource, "no global ~/.claude.json found");
      }
      continue;
    }
    const destination = join(profileDir(name), resource);
    try {
      await lstat(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      disabled.add(resource);
      annotations.set(resource, "missing from ~/.claude");
      continue;
    }
    try {
      const info = await lstat(destination);
      const target = info.isSymbolicLink() ? await readlink(destination) : null;
      if (!target || resolve(dirname(destination), target) !== source) {
        conflicts.add(resource);
        annotations.set(resource, "local data exists; confirmation and backup required");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { disabled, conflicts, annotations };
}

export async function sharedShowCommand(name: string): Promise<void> {
  const resources = await getSharedResources(name);
  console.log(resources.length ? resources.join("\n") : "No global Claude resources are shared.");
}

export async function sharedSetCommand(
  name: string,
  resources: string[] = [],
  opts: { force?: boolean; yes?: boolean } = {},
): Promise<void> {
  let selected = resources;
  let conflicts = new Set<string>();
  if (resources.length === 0) {
    const availability = await interactiveAvailability(name);
    conflicts = availability.conflicts;
    selected = await promptCheckboxes(
      `Shared global Claude resources for "${name}"`,
      SHARED_RESOURCES,
      await getSharedResources(name),
      availability,
    );
  } else if (opts.force) {
    conflicts = (await interactiveAvailability(name)).conflicts;
  }
  const replacements = selected.filter((resource) => conflicts.has(resource));
  if (replacements.length > 0 && !opts.yes) {
    const confirmed = await promptConfirm(
      `Replace local ${replacements.join(", ")} for "${name}" with shared symlinks? Existing data will be backed up.`,
    );
    if (!confirmed) {
      console.log("Shared resource update cancelled.");
      return;
    }
  }
  const backup = await setSharedResources(name, selected, {
    force: replacements.length > 0 || opts.force,
  });
  if (backup) console.log(`Existing profile resources were backed up at ${backup}.`);
  console.log(selected.length
    ? `Shared resources for "${name}": ${selected.join(", ")}`
    : `No global Claude resources are shared with "${name}".`);
}

export async function sharedClearCommand(name: string): Promise<void> {
  await setSharedResources(name, []);
  console.log(`Cleared shared resources for "${name}".`);
}

export function sharedChoices(): string { return SHARED_RESOURCES.join(", "); }
