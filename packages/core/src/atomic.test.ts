import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic, readJson } from "./atomic";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccm-atomic-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("readJson returns null for missing file", async () => {
  expect(await readJson(join(dir, "nope.json"))).toBeNull();
});

test("writeJsonAtomic then readJson round-trips", async () => {
  const p = join(dir, "a.json");
  await writeJsonAtomic(p, { hello: "world", n: 1 });
  expect(await readJson<{ hello: string; n: number }>(p)).toEqual({ hello: "world", n: 1 });
});

test("writeJsonAtomic creates parent directories", async () => {
  const p = join(dir, "deep", "nested", "a.json");
  await writeJsonAtomic(p, { ok: true });
  expect(await readJson<{ ok: boolean }>(p)).toEqual({ ok: true });
});

test("writeJsonAtomic leaves no temp files behind", async () => {
  const p = join(dir, "a.json");
  await writeJsonAtomic(p, { ok: true });
  expect(await readdir(dir)).toEqual(["a.json"]);
});
