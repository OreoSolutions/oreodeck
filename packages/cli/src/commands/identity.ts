import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  getProfile,
  profileDir,
  resolveProfileSelection,
  type ProfileKind,
  type ProfileSelectionSource,
} from "@ccm/core";
import { OREODECK_VERSION } from "../version";

const execFileAsync = promisify(execFile);

interface ClaudeAccountState {
  emailAddress?: unknown;
  organizationName?: unknown;
  organizationType?: unknown;
  displayName?: unknown;
}

export interface IdentityReport {
  oreodeck: {
    version: string;
    profile: string;
    profileKind: ProfileKind;
    selectionSource: ProfileSelectionSource;
    projectConfigPath: string | null;
    configDirectory: string;
  };
  claude: {
    version: string | null;
    loginMethod: string;
    organization: string | null;
    email: string | null;
    displayName: string | null;
    configuredModel: string;
    configuredMcpServers: number;
    settingSources: string[];
  };
  cwd: string;
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function claudeVersion(): Promise<string | null> {
  const binary = process.env.OREODECK_CLAUDE_BIN ?? process.env.CCM_CLAUDE_BIN ?? "claude";
  try {
    const { stdout, stderr } = await execFileAsync(binary, ["--version"], { timeout: 2_000 });
    return parseClaudeVersion(`${stdout}${stderr}`);
  } catch {
    return null;
  }
}

export function parseClaudeVersion(output: string): string | null {
  const normalized = output.trim();
  return normalized.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? (normalized || null);
}

function loginMethod(kind: ProfileKind, organizationType: string | null): string {
  if (kind === "api-key") return "API key";
  if (organizationType === "claude_max") return "Claude Max account";
  return "Claude subscription";
}

export async function buildIdentityReport(
  profileOverride?: string,
  cwd = process.cwd(),
): Promise<IdentityReport> {
  const selection = await resolveProfileSelection(profileOverride, cwd);
  const profile = await getProfile(selection.name);
  if (!profile) throw new Error(`Profile "${selection.name}" not found.`);

  const configDirectory = profileDir(profile.name);
  const state = await readObject(join(configDirectory, ".claude.json"));
  const account = state.oauthAccount && typeof state.oauthAccount === "object"
    && !Array.isArray(state.oauthAccount)
    ? state.oauthAccount as ClaudeAccountState
    : {};
  const settingsPath = join(configDirectory, "settings.json");
  const settings = await readObject(settingsPath);
  const mcpServers = state.mcpServers && typeof state.mcpServers === "object"
    && !Array.isArray(state.mcpServers)
    ? state.mcpServers as Record<string, unknown>
    : {};

  const settingSources: string[] = [];
  if (await fileExists(settingsPath)) settingSources.push("Profile settings");
  if (await fileExists(join(cwd, ".claude", "settings.json"))) settingSources.push("Project settings");
  if (await fileExists(join(cwd, ".claude", "settings.local.json"))) settingSources.push("Project local settings");
  if (settingSources.length === 0) settingSources.push("Claude defaults");

  const organizationType = safeString(account.organizationType);
  return {
    oreodeck: {
      version: OREODECK_VERSION,
      profile: profile.name,
      profileKind: profile.kind,
      selectionSource: selection.source,
      projectConfigPath: selection.projectConfigPath ?? null,
      configDirectory,
    },
    claude: {
      version: await claudeVersion(),
      loginMethod: loginMethod(profile.kind, organizationType),
      organization: safeString(account.organizationName),
      email: safeString(account.emailAddress),
      displayName: safeString(account.displayName),
      configuredModel: safeString(settings.model) ?? "Default",
      configuredMcpServers: Object.keys(mcpServers).length,
      settingSources,
    },
    cwd,
  };
}

function line(label: string, value: string | number | null): string {
  return `${`${label}:`.padEnd(21)}${value ?? "—"}`;
}

export async function identityCommand(opts: { profile?: string; json?: boolean }): Promise<void> {
  const report = await buildIdentityReport(opts.profile);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(line("OreoDeck version", report.oreodeck.version));
  console.log(line("Profile", report.oreodeck.profile));
  console.log(line("Profile kind", report.oreodeck.profileKind));
  console.log(line("Selection source", report.oreodeck.selectionSource));
  console.log(line("Claude version", report.claude.version));
  console.log(line("cwd", report.cwd));
  console.log(line("Config directory", report.oreodeck.configDirectory));
  console.log(line("Login method", report.claude.loginMethod));
  console.log(line("Organization", report.claude.organization));
  console.log(line("Email", report.claude.email));
  console.log(line("Model", report.claude.configuredModel));
  console.log(line("MCP servers", `${report.claude.configuredMcpServers} configured`));
  console.log(line("Setting sources", report.claude.settingSources.join(", ")));
  console.log("\nUse Claude's /status for live session ID, connection health and runtime model details.");
}
