import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  loadConfig, saveConfig, addProfile, removeProfile, setActive,
  getProfile, resolveProfileName,
} from "./profile-store";
import { profileDir } from "./paths";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-store-"));
  process.env.CCM_HOME = dir;
  delete process.env.OREODECK_PROFILE;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  delete process.env.OREODECK_PROFILE;
  await rm(dir, { recursive: true, force: true });
});

test("loadConfig returns defaults when no file exists", async () => {
  expect(await loadConfig()).toEqual({
    profiles: [], active: null, failoverEnabled: true, failoverOrder: [],
  });
});

test("loadConfig rejects valid JSON with an invalid runtime shape", async () => {
  await writeFile(join(dir, "config.json"), JSON.stringify({
    profiles: null, active: null, failoverEnabled: true, failoverOrder: [],
  }));
  await expect(loadConfig()).rejects.toThrow("invalid structure");
});

test("addProfile persists the profile and creates its config dir", async () => {
  await addProfile("work", "subscription");
  const c = await loadConfig();
  expect(c.profiles).toEqual([{ name: "work", kind: "subscription" }]);
  expect((await stat(profileDir("work"))).isDirectory()).toBe(true);
});

test("first added profile becomes active", async () => {
  await addProfile("work", "subscription");
  expect((await loadConfig()).active).toBe("work");
});

test("second added profile does not steal active", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  expect((await loadConfig()).active).toBe("work");
});

test("tab profile overrides the global active profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  process.env.OREODECK_PROFILE = "personal";
  expect(await resolveProfileName()).toBe("personal");
});

test("explicit -P profile overrides the tab profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  process.env.OREODECK_PROFILE = "personal";
  expect(await resolveProfileName("work")).toBe("work");
});

test("addProfile appends to failoverOrder", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  expect((await loadConfig()).failoverOrder).toEqual(["work", "personal"]);
});

test("concurrent profile additions do not lose either update", async () => {
  await Promise.all([addProfile("work", "subscription"), addProfile("personal", "subscription")]);
  const c = await loadConfig();
  expect(c.profiles.map((p) => p.name).sort()).toEqual(["personal", "work"]);
  expect(c.failoverOrder.slice().sort()).toEqual(["personal", "work"]);
});

test("addProfile rejects a duplicate name", async () => {
  await addProfile("work", "subscription");
  expect(addProfile("work", "api-key")).rejects.toThrow("already exists");
});

test("addProfile rejects an invalid name", async () => {
  expect(addProfile("../evil", "subscription")).rejects.toThrow("Invalid profile name");
  expect(addProfile("", "subscription")).rejects.toThrow("Invalid profile name");
});

test("removeProfile deletes the profile, its dir, and its config entry", async () => {
  await addProfile("work", "subscription");
  await removeProfile("work");
  expect((await loadConfig()).profiles).toEqual([]);
  expect(stat(profileDir("work"))).rejects.toThrow();
});

test("removeProfile clears active when the active profile is removed", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  await removeProfile("work");
  const c = await loadConfig();
  expect(c.active).toBe("personal");
  expect(c.failoverOrder).toEqual(["personal"]);
});

test("removeProfile throws for an unknown profile", async () => {
  expect(removeProfile("ghost")).rejects.toThrow("not found");
});

test("setActive switches the active profile", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  await setActive("personal");
  expect((await loadConfig()).active).toBe("personal");
});

test("setActive throws for an unknown profile", async () => {
  expect(setActive("ghost")).rejects.toThrow("not found");
});

test("getProfile returns null for an unknown profile", async () => {
  expect(await getProfile("ghost")).toBeNull();
});

test("resolveProfileName prefers the override", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  expect(await resolveProfileName("personal")).toBe("personal");
});

test("resolveProfileName falls back to active", async () => {
  await addProfile("work", "subscription");
  expect(await resolveProfileName()).toBe("work");
});

test("resolveProfileName throws when no profiles exist", async () => {
  expect(resolveProfileName()).rejects.toThrow("No active profile");
});

test("resolveProfileName throws for an unknown override", async () => {
  await addProfile("work", "subscription");
  expect(resolveProfileName("ghost")).rejects.toThrow("not found");
});

// Finding 1: APFS is case-insensitive by default, so "work" and "Work"
// would otherwise land on the same directory. The duplicate check must
// catch this regardless of casing.
test("addProfile rejects a duplicate that differs only in case (Finding 1)", async () => {
  await addProfile("work", "subscription");
  await expect(addProfile("Work", "api-key")).rejects.toThrow("already exists");
  const c = await loadConfig();
  expect(c.profiles).toEqual([{ name: "work", kind: "subscription" }]);
});

test("case-insensitive lookups resolve to the stored casing (Finding 1)", async () => {
  await addProfile("work", "subscription");
  expect(await getProfile("WORK")).toEqual({ name: "work", kind: "subscription" });
  expect(await resolveProfileName("Work")).toBe("work");
  await setActive("WORK");
  expect((await loadConfig()).active).toBe("work");
});

// Finding 2: removeProfile must destroy external resources (dir, Keychain)
// before committing the config change, so a mid-failure leaves the profile
// still listed (and the operation retryable) instead of silently vanishing
// from `ccm list` while its data survives as an orphan.
test("removeProfile does not remove the config entry when directory removal fails (Finding 2)", async () => {
  await addProfile("work", "subscription");
  const dir = profileDir("work");
  await writeFile(join(dir, "locked.txt"), "session data");
  // Strip write permission on the directory itself: recursive rm must
  // unlink "locked.txt" first, which requires write access on its parent.
  await chmod(dir, 0o500);
  try {
    await expect(removeProfile("work")).rejects.toThrow();
    const c = await loadConfig();
    expect(c.profiles).toEqual([{ name: "work", kind: "subscription" }]);
  } finally {
    await chmod(dir, 0o700);
  }
});

// Finding 3: a hand-edited/corrupted config.json can contain a traversal
// name. removeProfile must re-validate the stored name against NAME_RE
// before any destructive filesystem call, rather than trusting the entry.
test("removeProfile rejects a tampered traversal name and never touches the outside directory (Finding 3)", async () => {
  const victim = await mkdtemp(join(tmpdir(), "ccm-victim-"));
  try {
    // dir (CCM_HOME) = <tmp>/ccm-store-XXXX, so two levels up from
    // "profiles" is <tmp> itself — the same parent that holds `victim`.
    const evilName = `../../${basename(victim)}`;
    await saveConfig({
      profiles: [{ name: evilName, kind: "subscription" }],
      active: evilName,
      failoverEnabled: true,
      failoverOrder: [evilName],
    });
    await expect(removeProfile(evilName)).rejects.toThrow("Invalid profile name");
    expect((await stat(victim)).isDirectory()).toBe(true);
  } finally {
    await rm(victim, { recursive: true, force: true });
  }
});
