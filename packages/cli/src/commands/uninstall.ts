import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ccmHome, deleteApiKey, loadConfig } from "@ccm/core";
import { promptConfirm } from "../prompt";

interface UninstallOptions {
  yes?: boolean;
  purge?: boolean;
}

const execFileAsync = promisify(execFile);

function installPaths() {
  const home = homedir();
  return {
    binDir: process.env.OREODECK_INSTALL_BIN_DIR || join(home, ".local", "bin"),
    appDir: process.env.OREODECK_INSTALL_APP_DIR || join(home, "Applications"),
    zshrc: process.env.OREODECK_ZSHRC || join(home, ".zshrc"),
    payloadDir: process.env.OREODECK_UI_PAYLOAD_DIR || join(home, ".local", "share", "oreodeck"),
  };
}

async function removeShellIntegration(path: string): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const cleaned = contents
    .replace(/\n?# >>> OreoDeck shell integration v2 >>>[\s\S]*?# <<< OreoDeck shell integration v2 <<<\n?/g, "\n")
    .replace(/\n?# >>> OreoDeck shell integration >>>[\s\S]*?# <<< OreoDeck shell integration <<<\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  if (cleaned !== contents) await writeFile(path, cleaned, "utf8");
}

async function stopAndRemoveApp(appDir: string): Promise<void> {
  // A running menu-bar app keeps its executable open and may recreate state
  // during termination, so stop it before deleting the bundle and backups.
  await execFileAsync("pkill", ["-x", "OreoDeck"]).catch((error: NodeJS.ErrnoException & { code?: number }) => {
    if (error.code !== 1) throw error;
  });
  let entries: string[];
  try { entries = await readdir(appDir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry === "OreoDeck.app" || entry.startsWith("OreoDeck.app.backup-")) {
      await rm(join(appDir, entry), { recursive: true, force: true });
    }
  }
}

export async function uninstallCommand(opts: UninstallOptions): Promise<void> {
  const scope = opts.purge
    ? "OreoDeck, every profile, config file, session and stored API key"
    : "the OreoDeck app, CLI and shell integration (profiles will be kept)";
  if (!opts.yes && !(await promptConfirm(`Remove ${scope}?`))) {
    console.log("Uninstall cancelled.");
    return;
  }

  if (opts.purge) {
    const config = await loadConfig();
    for (const profile of config.profiles) {
      if (profile.kind === "api-key") await deleteApiKey(profile.name);
    }
    await rm(ccmHome(), { recursive: true, force: true });
  }

  const paths = installPaths();
  await removeShellIntegration(paths.zshrc);
  await stopAndRemoveApp(paths.appDir);
  await rm(join(paths.binDir, "oreodeck"), { force: true });
  await rm(join(paths.binDir, "ord"), { force: true });
  await rm(paths.payloadDir, { recursive: true, force: true });

  console.log(opts.purge
    ? "OreoDeck and all profile data were removed."
    : `OreoDeck was removed. Profile data is still available at ${ccmHome()}.`);
  console.log("Open a new Terminal tab to clear the old shell functions.");
}
