import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureBuiltinOreoDeckSkill, ensureBuiltinSkillsForProfiles } from "./builtin-skills";
import { profileDir } from "./paths";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "oreodeck-skill-"));
  process.env.OREODECK_HOME = root;
});

afterEach(async () => {
  delete process.env.OREODECK_HOME;
  await rm(root, { recursive: true, force: true });
});

test("installs and then preserves the managed OreoDeck skill", async () => {
  expect(await ensureBuiltinOreoDeckSkill("work")).toBe("created");
  const path = join(profileDir("work"), "skills", "oreodeck", "SKILL.md");
  expect(await readFile(path, "utf8")).toContain("managed-by: oreodeck");
  expect(await ensureBuiltinOreoDeckSkill("work")).toBe("unchanged");
});

test("does not overwrite a user-owned skill with the same name", async () => {
  const path = join(profileDir("work"), "skills", "oreodeck", "SKILL.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "user-owned");
  expect(await ensureBuiltinOreoDeckSkill("work")).toBe("conflict");
  expect(await readFile(path, "utf8")).toBe("user-owned");
});

test("automatically installs the skill for existing profiles", async () => {
  await ensureBuiltinSkillsForProfiles([{ name: "work" }, { name: "personal" }]);
  for (const name of ["work", "personal"]) {
    const path = join(profileDir(name), "skills", "oreodeck", "SKILL.md");
    expect(await readFile(path, "utf8")).toContain("managed-by: oreodeck");
  }
});
