import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile, resolveProfileName } from "./profile-store";
import { findProjectProfile, setProjectProfile } from "./project-config";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "oreodeck-project-config-"));
  process.env.OREODECK_HOME = join(root, "data");
  delete process.env.OREODECK_PROFILE;
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
});

afterEach(async () => {
  delete process.env.OREODECK_HOME;
  delete process.env.OREODECK_PROFILE;
  await rm(root, { recursive: true, force: true });
});

test("finds the nearest project profile from a nested directory", async () => {
  const project = join(root, "repo");
  const nested = join(project, "packages", "app");
  await mkdir(join(project, ".oreodeck"), { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(join(project, ".oreodeck", "config.json"), JSON.stringify({ profile: "personal" }));
  expect((await findProjectProfile(nested))?.profile).toBe("personal");
});

test("profile precedence is explicit then project then tab then global", async () => {
  const project = join(root, "repo");
  await mkdir(project);
  await setProjectProfile("personal", project);
  process.env.OREODECK_PROFILE = "work";
  expect(await resolveProfileName(undefined, project)).toBe("personal");
  expect(await resolveProfileName("work", project)).toBe("work");
  expect(await resolveProfileName(undefined, root)).toBe("work");
  delete process.env.OREODECK_PROFILE;
  expect(await resolveProfileName(undefined, root)).toBe("work");
});

test("writes canonical profile casing to .oreodeck/config.json", async () => {
  const project = join(root, "repo");
  await mkdir(project);
  const path = await setProjectProfile("PERSONAL", project);
  expect(path).toBe(join(project, ".oreodeck", "config.json"));
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ profile: "personal" });
});

test("rejects malformed project config instead of silently choosing another identity", async () => {
  const project = join(root, "repo");
  await mkdir(join(project, ".oreodeck"), { recursive: true });
  await writeFile(join(project, ".oreodeck", "config.json"), "{}");
  await expect(resolveProfileName(undefined, project)).rejects.toThrow('must contain a non-empty "profile" string');
});
