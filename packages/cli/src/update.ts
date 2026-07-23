import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ccmHome } from "@ccm/core";
import { promptConfirm } from "./prompt";
import { OREODECK_REPOSITORY, OREODECK_VERSION } from "./version";

type ReleaseAsset = { name: string; browser_download_url: string };
export type ReleaseInfo = { version: string; htmlUrl: string; assets: ReleaseAsset[] };
type UpdateCache = { checkedAt: number; release: ReleaseInfo | null; etag?: string };
type VersionCache = { checkedAt: number; version: string };
export type ReleaseFetchResult = { release: ReleaseInfo | null; etag?: string; notModified: boolean };

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const API_URL = `https://api.github.com/repos/${OREODECK_REPOSITORY}/releases/latest`;
const VERSION_URL = `https://github.com/${OREODECK_REPOSITORY}/releases/latest/download/oreodeck-version.txt`;

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

export async function fetchPublishedVersion(fetcher: Fetcher = fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetcher(process.env.OREODECK_VERSION_URL || VERSION_URL, {
      headers: { "User-Agent": `OreoDeck/${OREODECK_VERSION}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Version check returned HTTP ${response.status}.`);
    const version = (await response.text()).trim().replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Published version manifest is invalid.");
    return version;
  } finally {
    clearTimeout(timer);
  }
}

export async function cachedPublishedVersion(
  fetcher: Fetcher = fetch,
  now = Date.now(),
): Promise<string> {
  const path = join(ccmHome(), "version-check.json");
  let cache: VersionCache | null = null;
  try { cache = JSON.parse(await readFile(path, "utf8")) as VersionCache; }
  catch { /* Missing/corrupt cache is refreshed below. */ }
  if (cache && now - cache.checkedAt < VERSION_CHECK_INTERVAL_MS) return cache.version;
  try {
    const version = await fetchPublishedVersion(fetcher);
    await mkdir(ccmHome(), { recursive: true });
    await writeFile(path, `${JSON.stringify({ checkedAt: now, version })}\n`, { mode: 0o600 });
    return version;
  } catch (error) {
    if (cache) return cache.version;
    throw error;
  }
}

export async function fetchLatestReleaseConditional(
  fetcher: Fetcher = fetch,
  etag?: string,
): Promise<ReleaseFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": `OreoDeck/${OREODECK_VERSION}`,
    };
    if (etag) headers["If-None-Match"] = etag;
    if (process.env.OREODECK_GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.OREODECK_GITHUB_TOKEN}`;
    }
    const response = await fetcher(process.env.OREODECK_UPDATE_API_URL || API_URL, {
      headers,
      signal: controller.signal,
    });
    if (response.status === 304) return { release: null, etag, notModified: true };
    if (response.status === 404) return { release: null, etag: response.headers.get("etag") ?? undefined, notModified: false };
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const json = await response.json() as { tag_name?: string; html_url?: string; assets?: ReleaseAsset[] };
    const release = json.tag_name && json.html_url
      ? { version: json.tag_name.replace(/^v/, ""), htmlUrl: json.html_url, assets: json.assets ?? [] }
      : null;
    return { release, etag: response.headers.get("etag") ?? undefined, notModified: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLatestRelease(fetcher: Fetcher = fetch): Promise<ReleaseInfo | null> {
  return (await fetchLatestReleaseConditional(fetcher)).release;
}

async function cachedLatestRelease(force = false): Promise<ReleaseInfo | null> {
  const path = join(ccmHome(), "update-check.json");
  let cache: UpdateCache | null = null;
  try { cache = JSON.parse(await readFile(path, "utf8")) as UpdateCache; }
  catch { /* Missing or corrupt cache: fetch again. */ }

  if (!force && cache) {
    // Once a newer release is known, every command must keep prompting until
    // it is installed; never hide it behind the refresh interval.
    if (cache.release && compareVersions(cache.release.version, OREODECK_VERSION) > 0) {
      return cache.release;
    }
    if (Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) return cache.release;
  }

  try {
    const result = await fetchLatestReleaseConditional(fetch, cache?.etag);
    const release = result.notModified ? (cache?.release ?? null) : result.release;
    await mkdir(ccmHome(), { recursive: true });
    await writeFile(path, `${JSON.stringify({
      checkedAt: Date.now(),
      release,
      etag: result.etag ?? cache?.etag,
    })}\n`, { mode: 0o600 });
    return release;
  } catch (error) {
    // Offline/rate-limited commands still use a previously known update and
    // must never fail just because release discovery could not refresh.
    if (cache) return cache.release;
    throw error;
  }
}

export async function availableUpdate(force = false): Promise<ReleaseInfo | null> {
  const release = await cachedLatestRelease(force);
  return release && compareVersions(release.version, OREODECK_VERSION) > 0 ? release : null;
}

async function manifestAvailableUpdate(): Promise<ReleaseInfo | null> {
  const cachePath = join(ccmHome(), "update-check.json");
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as UpdateCache;
    if (cache.release && compareVersions(cache.release.version, OREODECK_VERSION) > 0) {
      return cache.release;
    }
  } catch { /* The tiny remote manifest will repopulate update metadata. */ }

  const publishedVersion = await cachedPublishedVersion();
  if (compareVersions(publishedVersion, OREODECK_VERSION) <= 0) return null;
  // Only consume the GitHub API when the stable manifest proves a newer
  // release exists. This fetch also gives us verified asset URLs.
  return availableUpdate(true);
}

function releaseArch(): string {
  return process.arch === "x64" ? "x86_64" : process.arch;
}

export function progressLine(label: string, completed: number, total: number): string {
  const width = 24;
  const ratio = total > 0 ? Math.min(1, completed / total) : 0;
  const filled = Math.round(ratio * width);
  return `${label} [${"█".repeat(filled)}${"░".repeat(width - filled)}] ${Math.round(ratio * 100)}%`;
}

async function download(url: string, label?: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": `OreoDeck/${OREODECK_VERSION}` } });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
  if (!label || !response.body) return Buffer.from(await response.arrayBuffer());
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let completed = 0;
  if (total > 0) process.stdout.write(`\r${progressLine(label, 0, total)}`);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    completed += value.byteLength;
    if (total > 0) process.stdout.write(`\r${progressLine(label, completed, total)}`);
  }
  if (total > 0) process.stdout.write("\n");
  else console.log(`${label} downloaded (${completed.toLocaleString()} bytes).`);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function run(
  command: string,
  args: string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}

/** Preserve the choices from the existing installation. Updates should have
 * exactly one confirmation prompt and must never re-run first-install setup. */
export async function updateInstallerEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const home = base.HOME || homedir();
  const appDir = base.OREODECK_INSTALL_APP_DIR || join(home, "Applications");
  const zshrc = base.OREODECK_ZSHRC || join(home, ".zshrc");
  let shellInstalled = false;
  try {
    const contents = await readFile(zshrc, "utf8");
    shellInstalled = contents.includes("# >>> OreoDeck shell integration");
  } catch { /* A missing shell file means shell integration was not installed. */ }
  return {
    ...base,
    OREODECK_INSTALL_UI: await exists(join(appDir, "OreoDeck.app")) ? "Y" : "N",
    OREODECK_INSTALL_SHELL: shellInstalled ? "Y" : "N",
    OREODECK_UPDATE_MODE: "1",
  };
}

export async function installRelease(release: ReleaseInfo): Promise<void> {
  const expected = `oreodeck-${release.version}-macos-${releaseArch()}.zip`;
  const archiveAsset = release.assets.find((asset) => asset.name === expected);
  const checksumAsset = release.assets.find((asset) => asset.name === `${expected}.sha256`);
  if (!archiveAsset || !checksumAsset) throw new Error(`Release ${release.version} does not contain ${expected} and its checksum.`);

  const dir = await mkdtemp(join(tmpdir(), "oreodeck-update-"));
  try {
    console.log(`\nUpdating OreoDeck ${OREODECK_VERSION} → ${release.version}`);
    const checksumFile = await download(checksumAsset.browser_download_url);
    const archive = await download(archiveAsset.browser_download_url, "Downloading");
    const checksumText = checksumFile.toString("utf8").trim();
    const expectedHash = checksumText.split(/\s+/)[0];
    const actualHash = createHash("sha256").update(archive).digest("hex");
    if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash) || expectedHash.toLowerCase() !== actualHash) {
      throw new Error("Release checksum verification failed; update aborted.");
    }
    console.log("✓ Checksum verified");
    const archivePath = join(dir, basename(archiveAsset.name));
    await writeFile(archivePath, archive, { mode: 0o600 });
    await run("ditto", ["-x", "-k", archivePath, dir]);
    const root = (await readdir(dir, { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name.startsWith("oreodeck-"));
    if (!root) throw new Error("Release archive has no installable directory.");
    const installScript = join(dir, root.name, "install.sh");
    await run(
      "/bin/bash",
      [installScript],
      join(dir, root.name),
      await updateInstallerEnvironment(),
    );
    console.log(`\n✓ OreoDeck ${release.version} installed successfully`);
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
    const release = await manifestAvailableUpdate();
    if (release && await promptConfirm(`OreoDeck ${release.version} is available. Update now?`)) {
      await installRelease(release);
    }
  } catch {
    // Update discovery must never prevent the requested command from running.
  }
}
