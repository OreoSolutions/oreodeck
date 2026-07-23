import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

function uiPaths() {
  const home = homedir();
  return {
    payload: process.env.OREODECK_UI_PAYLOAD
      || join(home, ".local", "share", "oreodeck", "OreoDeck.app"),
    app: join(process.env.OREODECK_INSTALL_APP_DIR || join(home, "Applications"), "OreoDeck.app"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcess(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", () => resolve());
    child.once("exit", () => resolve());
  });
}

export async function uiInstallCommand(): Promise<void> {
  const { payload, app } = uiPaths();
  const restartInstalledApp = process.platform === "darwin" && !process.env.OREODECK_INSTALL_APP_DIR;
  if (!(await exists(payload))) {
    throw new Error(
      "OreoDeck UI payload is not available. Re-run install.sh from a full OreoDeck Release package.",
    );
  }

  await mkdir(dirname(app), { recursive: true });
  if (restartInstalledApp) await waitForProcess("pkill", ["-x", "OreoDeck"]);
  if (await exists(app)) {
    const backup = `${app}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(app, backup);
    console.log(`Existing app backed up at ${backup}.`);
  }
  await cp(payload, app, { recursive: true, preserveTimestamps: true });
  console.log(`OreoDeck UI installed at ${app}.`);
  if (restartInstalledApp) {
    const child = spawn("open", [app], { detached: true, stdio: "ignore" });
    child.unref();
    console.log("OreoDeck restarted with the installed version.");
  }
}

export async function uiOpenCommand(): Promise<void> {
  const { app } = uiPaths();
  if (!(await exists(app))) throw new Error("OreoDeck UI is not installed. Run `ord ui install` first.");
  const child = spawn("open", [app], { detached: true, stdio: "ignore" });
  child.unref();
}

export async function uiRemoveCommand(): Promise<void> {
  const { app } = uiPaths();
  await rm(app, { recursive: true, force: true });
  console.log("OreoDeck UI removed. CLI and profiles were kept.");
}
