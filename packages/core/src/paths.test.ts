import { expect, test, afterEach } from "bun:test";
import { isAbsolute } from "node:path";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { assertValidName, ccmHome, profileDir, configPath } from "./paths";

afterEach(() => {
  delete process.env.CCM_HOME;
  delete process.env.OREODECK_HOME;
});

function expectedDefaultHome(): string {
  const current = join(homedir(), ".oreodeck");
  const legacy = join(homedir(), ".ccm");
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

test("ccmHome defaults to the current home while preserving a legacy install", () => {
  delete process.env.CCM_HOME;
  expect(ccmHome()).toBe(expectedDefaultHome());
});

test("ccmHome respects CCM_HOME override", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(ccmHome()).toBe("/tmp/test-ccm");
});

test("ccmHome treats an empty CCM_HOME as unset", () => {
  process.env.CCM_HOME = "";
  expect(ccmHome()).toBe(expectedDefaultHome());
});

test("ccmHome resolves a relative CCM_HOME to an absolute path under CWD", () => {
  process.env.CCM_HOME = "./foo";
  expect(ccmHome()).toBe(`${process.cwd()}/foo`);
  expect(ccmHome().startsWith("/")).toBe(true);
});

test("ccmHome treats a whitespace-only CCM_HOME as unset", () => {
  process.env.CCM_HOME = " ";
  expect(ccmHome()).toBe(expectedDefaultHome());
});

test("ccmHome treats a tab-only CCM_HOME as unset", () => {
  process.env.CCM_HOME = "\t";
  expect(ccmHome()).toBe(expectedDefaultHome());
});

test("ccmHome treats a newline-only CCM_HOME as unset", () => {
  process.env.CCM_HOME = "\n";
  expect(ccmHome()).toBe(expectedDefaultHome());
});

test("ccmHome treats a mixed-whitespace CCM_HOME as unset", () => {
  process.env.CCM_HOME = "  \t\n  ";
  expect(ccmHome()).toBe(expectedDefaultHome());
});

test("ccmHome trims surrounding whitespace from an otherwise valid relative CCM_HOME", () => {
  process.env.CCM_HOME = "  ./foo  ";
  expect(ccmHome()).toBe(`${process.cwd()}/foo`);
});

test("ccmHome never returns a CWD-relative path, for any CCM_HOME value", () => {
  const values = [undefined, "", " ", "\t", "\n", "  \t\n  ", "./foo", "  ./foo  ", "/tmp/test-ccm", "."];
  for (const v of values) {
    if (v === undefined) delete process.env.CCM_HOME;
    else process.env.CCM_HOME = v;
    expect(isAbsolute(ccmHome())).toBe(true);
  }
});

test("profileDir builds path under profiles/", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(profileDir("work")).toBe("/tmp/test-ccm/profiles/work");
});

// I-2: profileDir() is the single chokepoint every filesystem/spawn path
// derives from (launcher, failover, usage, add-login), so it must reject a
// traversal name itself rather than relying on each caller to re-validate.
test("profileDir rejects a traversal name", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(() => profileDir("../x")).toThrow("Invalid profile name");
  expect(() => profileDir("../../../../tmp/x")).toThrow("Invalid profile name");
});

test("profileDir rejects an empty or malformed name", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(() => profileDir("")).toThrow("Invalid profile name");
  expect(() => profileDir("has space")).toThrow("Invalid profile name");
});

test("assertValidName is the single source of truth profileDir uses", () => {
  expect(() => assertValidName("work")).not.toThrow();
  expect(() => assertValidName("../evil")).toThrow("Invalid profile name");
});

test("configPath is config.json under home", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(configPath()).toBe("/tmp/test-ccm/config.json");
});
