import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ccmHome } from "@ccm/core";
import { promptConfirm } from "./prompt";
import { OREODECK_REPOSITORY, OREODECK_VERSION } from "./version";

type ReleaseAsset = { name: string; browser_download_url: string };
export type ReleaseInfo = { version: string; htmlUrl: string; assets: ReleaseAsset[] };
type UpdateCache = { checkedAt: number; release: ReleaseInfo | null };

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const API_URL = `https://api.github.com/repos/${OREODECK_REPOSITORY}/releases/latest`;

export function compareVersions(left: string, right: string): number {
  const a = left.replace(/^v/, "").split(".").map(Number);
  const b = right.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function fetchLatestRelease(fetcher: Fetcher = fetch): Promise<ReleaseInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetcher(process.env.OREODECK_UPDATE_API_URL || API_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `OreoDeck/${OREODECK_VERSION}` },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const json = await response.json() as { tag_name?: string; html_url?: string; assets?: ReleaseAsset[] };
    if (!json.tag_name || !json.html_url) return null;
    return { version: json.tag_name.replace(/^v/, ""), htmlUrl: json.html_url, assets: json.assets ?? [] };
  } finally {
    clearTimeout(timer);
  }
}

async function cachedLatestRelease(force = false): Promise<ReleaseInfo | null> {
  const path = join(ccmHome(), "update-check.json");
  if (!force) {
    try {
      const cache = JSON.parse(await readFile(path, "utf8")) as UpdateCache;
      if (Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) return cache.release;
    } catch { /* Missing or corrupt cache: fetch again. */ }
  }
  const release = await fetchLatestRelease();
  await mkdir(ccmHome(), { recursive: true });
  await writeFile(path, `${JSON.stringify({ checkedAt: Date.now(), release })}\n`, { mode: 0o600 });
  return release;
}

export async function availableUpdate(force = false): Promise<ReleaseInfo | null> {
  const release = await cachedLatestRelease(force);
  return release && compareVersions(release.version, OREODECK_VERSION) > 0 ? release : null;
}

function releaseArch(): string {
  return process.arch === "x64" ? "x86_64" : process.arch;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": `OreoDeck/${OREODECK_VERSION}` } });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function run(command: string, args: string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

export async function installRelease(release: ReleaseInfo): Promise<void> {
  const expected = `oreodeck-${release.version}-macos-${releaseArch()}.zip`;
  const archiveAsset = release.assets.find((asset) => asset.name === expected);
  const checksumAsset = release.assets.find((asset) => asset.name === `${expected}.sha256`);
  if (!archiveAsset || !checksumAsset) throw new Error(`Release ${release.version} does not contain ${expected} and its checksum.`);

  const dir = await mkdtemp(join(tmpdir(), "oreodeck-update-"));
  try {
    const [archive, checksumFile] = await Promise.all([
      download(archiveAsset.browser_download_url),
      download(checksumAsset.browser_download_url),
    ]);
    const checksumText = checksumFile.toString("utf8").trim();
    const expectedHash = checksumText.split(/\s+/)[0];
    const actualHash = createHash("sha256").update(archive).digest("hex");
    if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash) || expectedHash.toLowerCase() !== actualHash) {
      throw new Error("Release checksum verification failed; update aborted.");
    }
    const archivePath = join(dir, basename(archiveAsset.name));
    await writeFile(archivePath, archive, { mode: 0o600 });
    await run("ditto", ["-x", "-k", archivePath, dir]);
    const root = (await readdir(dir, { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name.startsWith("oreodeck-"));
    if (!root) throw new Error("Release archive has no installable directory.");
    const installScript = join(dir, root.name, "install.sh");
    await run("/bin/bash", [installScript], join(dir, root.name));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function updateCommand(opts: { check?: boolean; yes?: boolean } = {}): Promise<void> {
  const release = await availableUpdate(true);
  if (!release) {
    console.log(`OreoDeck ${OREODECK_VERSION} is up to date.`);
    return;
  }
  console.log(`OreoDeck ${release.version} is available (installed: ${OREODECK_VERSION}).`);
  if (opts.check) return;
  if (!opts.yes && !(await promptConfirm("Download, verify and install this update?"))) {
    console.log("Update cancelled.");
    return;
  }
  await installRelease(release);
}

export async function maybePromptForUpdate(argv: string[]): Promise<void> {
  if (process.env.OREODECK_DISABLE_UPDATE_CHECK || !process.stdin.isTTY || !process.stdout.isTTY) return;
  if (["update", "uninstall", "shell-init"].includes(argv[0] ?? "")) return;
  try {
    const release = await availableUpdate(false);
    if (release && await promptConfirm(`OreoDeck ${release.version} is available. Update now?`)) {
      await installRelease(release);
    }
  } catch {
    // Update discovery must never prevent the requested command from running.
  }
}
