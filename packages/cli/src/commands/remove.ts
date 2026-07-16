import { removeProfile, getProfile } from "@ccm/core";
import { promptConfirm } from "../prompt";

interface RemoveOptions {
  yes?: boolean;
}

export async function removeCommand(name: string, opts: RemoveOptions): Promise<void> {
  if (!(await getProfile(name))) {
    throw new Error(`Profile "${name}" not found. Run \`ccm list\` to see profiles.`);
  }
  if (!opts.yes) {
    const ok = await promptConfirm(
      `Remove profile "${name}"? This deletes its login and session history.`,
    );
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }
  await removeProfile(name);
  console.log(`Removed profile "${name}".`);
}
