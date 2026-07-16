import { expect, test, afterEach } from "bun:test";
import { isAbsolute } from "node:path";
import { ccmHome, profileDir, configPath } from "./paths";

afterEach(() => {
  delete process.env.CCM_HOME;
});

test("ccmHome defaults to ~/.ccm", () => {
  delete process.env.CCM_HOME;
  expect(ccmHome()).toBe(`${process.env.HOME}/.ccm`);
});

test("ccmHome respects CCM_HOME override", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(ccmHome()).toBe("/tmp/test-ccm");
});

test("ccmHome treats an empty CCM_HOME as unset", () => {
  process.env.CCM_HOME = "";
  expect(ccmHome()).toBe(`${process.env.HOME}/.ccm`);
});

test("ccmHome resolves a relative CCM_HOME to an absolute path under CWD", () => {
  process.env.CCM_HOME = "./foo";
  expect(ccmHome()).toBe(`${process.cwd()}/foo`);
  expect(ccmHome().startsWith("/")).toBe(true);
});

test("ccmHome treats a whitespace-only CCM_HOME as unset", () => {
  process.env.CCM_HOME = " ";
  expect(ccmHome()).toBe(`${process.env.HOME}/.ccm`);
});

test("ccmHome treats a tab-only CCM_HOME as unset", () => {
  process.env.CCM_HOME = "\t";
  expect(ccmHome()).toBe(`${process.env.HOME}/.ccm`);
});

test("ccmHome treats a newline-only CCM_HOME as unset", () => {
  process.env.CCM_HOME = "\n";
  expect(ccmHome()).toBe(`${process.env.HOME}/.ccm`);
});

test("ccmHome treats a mixed-whitespace CCM_HOME as unset", () => {
  process.env.CCM_HOME = "  \t\n  ";
  expect(ccmHome()).toBe(`${process.env.HOME}/.ccm`);
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

test("configPath is config.json under home", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(configPath()).toBe("/tmp/test-ccm/config.json");
});
