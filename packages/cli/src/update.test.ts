import { describe, expect, test } from "bun:test";
import { compareVersions, fetchLatestRelease } from "./update";

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
});
