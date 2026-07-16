import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, addProfile, removeProfile, setActive,
  getProfile, resolveProfileName,
} from "./profile-store";
import { profileDir } from "./paths";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-store-"));
  process.env.CCM_HOME = dir;
});

afterEach(async () => {
  delete process.env.CCM_HOME;
  await rm(dir, { recursive: true, force: true });
});

test("loadConfig returns defaults when no file exists", async () => {
  expect(await loadConfig()).toEqual({
    profiles: [], active: null, failoverEnabled: true, failoverOrder: [],
  });
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

test("addProfile appends to failoverOrder", async () => {
  await addProfile("work", "subscription");
  await addProfile("personal", "subscription");
  expect((await loadConfig()).failoverOrder).toEqual(["work", "personal"]);
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
