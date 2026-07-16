import { expect, test, afterEach } from "bun:test";
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

test("profileDir builds path under profiles/", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(profileDir("work")).toBe("/tmp/test-ccm/profiles/work");
});

test("configPath is config.json under home", () => {
  process.env.CCM_HOME = "/tmp/test-ccm";
  expect(configPath()).toBe("/tmp/test-ccm/config.json");
});
