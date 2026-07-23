import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, fetchLatestRelease, updateInstallerEnvironment } from "./update";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("update discovery", () => {
  test("compares semantic numeric versions", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  test("normalizes the latest GitHub release", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      tag_name: "v0.2.0",
      html_url: "https://github.com/OreoSolutions/oreodeck/releases/tag/v0.2.0",
      assets: [{ name: "oreodeck-macos-arm64.zip", browser_download_url: "https://example.test/app.zip" }],
    }), { status: 200 }));
    const release = await fetchLatestRelease(fakeFetch);
    expect(release?.version).toBe("0.2.0");
    expect(release?.assets[0]?.name).toBe("oreodeck-macos-arm64.zip");
  });

  test("treats a repository with no releases as empty", async () => {
    const fakeFetch = async () => new Response("not found", { status: 404 });
    expect(await fetchLatestRelease(fakeFetch)).toBeNull();
  });

  test("updates preserve installed UI and shell choices without prompting again", async () => {
    const home = await mkdtemp(join(tmpdir(), "oreodeck-update-env-"));
    temporaryRoots.push(home);
    await mkdir(join(home, "Applications", "OreoDeck.app"), { recursive: true });
    await writeFile(join(home, ".zshrc"), "# >>> OreoDeck shell integration v2 >>>\n");

    const env = await updateInstallerEnvironment({ HOME: home });
    expect(env.OREODECK_INSTALL_UI).toBe("Y");
    expect(env.OREODECK_INSTALL_SHELL).toBe("Y");
    expect(env.OREODECK_UPDATE_MODE).toBe("1");
  });

  test("updates do not add UI or shell integration that were not installed", async () => {
    const home = await mkdtemp(join(tmpdir(), "oreodeck-update-env-"));
    temporaryRoots.push(home);
    const env = await updateInstallerEnvironment({ HOME: home });
    expect(env.OREODECK_INSTALL_UI).toBe("N");
    expect(env.OREODECK_INSTALL_SHELL).toBe("N");
  });
});
