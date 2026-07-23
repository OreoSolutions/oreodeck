import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProfile, profileDir } from "@ccm/core";
import { buildIdentityReport, parseClaudeVersion } from "./identity";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "oreodeck-identity-"));
  process.env.OREODECK_HOME = join(root, "data");
  const claude = join(root, "claude");
  await writeFile(claude, "#!/bin/sh\necho '2.1.218 (Claude Code)'\n");
  await chmod(claude, 0o755);
  process.env.OREODECK_CLAUDE_BIN = claude;
  await addProfile("work", "subscription");
});

afterEach(async () => {
  delete process.env.OREODECK_HOME;
  delete process.env.OREODECK_CLAUDE_BIN;
  delete process.env.OREODECK_PROFILE;
  await rm(root, { recursive: true, force: true });
});

test("reports the resolved profile and only allow-listed account fields", async () => {
  const dir = profileDir("work");
  await writeFile(join(dir, ".claude.json"), JSON.stringify({
    oauthAccount: {
      emailAddress: "person@example.com",
      organizationName: "Example Org",
      organizationType: "claude_max",
      displayName: "Person",
      accountUuid: "must-not-leak",
      accessToken: "super-secret-token",
    },
    mcpServers: { one: {}, two: {} },
  }));
  await writeFile(join(dir, "settings.json"), JSON.stringify({
    model: "opus",
    apiKey: "another-secret",
  }));

  const report = await buildIdentityReport(undefined, root);
  expect(report.oreodeck.profile).toBe("work");
  expect(report.oreodeck.selectionSource).toBe("global");
  expect(report.claude).toMatchObject({
    loginMethod: "Claude Max account",
    organization: "Example Org",
    email: "person@example.com",
    displayName: "Person",
    configuredModel: "opus",
    configuredMcpServers: 2,
  });
  const serialized = JSON.stringify(report);
  expect(serialized).not.toContain("must-not-leak");
  expect(serialized).not.toContain("super-secret-token");
  expect(serialized).not.toContain("another-secret");
});

test("extracts the Claude semantic version from command output", () => {
  expect(parseClaudeVersion("2.1.218 (Claude Code)\n")).toBe("2.1.218");
  expect(parseClaudeVersion("  ")).toBeNull();
});

test("explicit profile selection is reported", async () => {
  await addProfile("personal", "api-key");
  process.env.OREODECK_PROFILE = "work";
  const report = await buildIdentityReport("personal", root);
  expect(report.oreodeck.selectionSource).toBe("explicit");
  expect(report.oreodeck.profile).toBe("personal");
  expect(report.claude.loginMethod).toBe("API key");
});
