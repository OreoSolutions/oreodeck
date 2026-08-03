import { spawn } from "node:child_process";
import { profileDir } from "./paths";
import { getApiKey } from "./keychain";
import { getProfile, type GatewayModelMappingKey, type Profile } from "./profile-store";
import { syncSharedConfiguration } from "./shared-config";
import { ensureBuiltinOreoDeckSkill } from "./builtin-skills";
import { ensureUsageStatuslineProxy } from "./statusline-proxy";

export interface LaunchResult {
  code: number;
}

const GATEWAY_MODEL_ENV: Record<GatewayModelMappingKey, string> = {
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  fable: "ANTHROPIC_DEFAULT_FABLE_MODEL",
};

/**
 * Env cho tiến trình claude con. Mấu chốt là CLAUDE_CONFIG_DIR — nó khiến
 * Claude Code coi mỗi profile là một danh tính độc lập.
 */
export async function buildEnv(
  profile: Profile,
  apiKey: string | null,
  base: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  await syncSharedConfiguration(profile.name, profile.sharedResources ?? []);
  await ensureBuiltinOreoDeckSkill(profile.name);
  await ensureUsageStatuslineProxy(profile.name);
  const env: NodeJS.ProcessEnv = { ...base };
  env.CLAUDE_CONFIG_DIR = profileDir(profile.name);
  // The selected OreoDeck profile, rather than a parent shell, owns every
  // Claude API routing credential. This prevents a stale gateway or token
  // from silently changing where a subscription/API-key profile sends code.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  for (const variable of Object.values(GATEWAY_MODEL_ENV)) delete env[variable];
  if (profile.kind === "api-key") {
    if (!apiKey) throw new Error(`No API key stored for profile "${profile.name}".`);
    env.ANTHROPIC_API_KEY = apiKey;
  } else if (profile.kind === "gateway") {
    if (!apiKey) throw new Error(`No API key stored for gateway profile "${profile.name}".`);
    if (!profile.gatewayBaseUrl) throw new Error(`Gateway profile "${profile.name}" has no base URL.`);
    env.ANTHROPIC_BASE_URL = profile.gatewayBaseUrl;
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    for (const [family, modelId] of Object.entries(profile.modelMappings ?? {})) {
      if (modelId) env[GATEWAY_MODEL_ENV[family as GatewayModelMappingKey]] = modelId;
    }
  }
  return env;
}

/** Chạy `claude` với profile chỉ định, pass-through toàn bộ stdin/stdout/TTY. */
export async function launchClaude(
  profileName: string,
  args: string[],
): Promise<LaunchResult> {
  const profile = await getProfile(profileName);
  if (!profile) throw new Error(`Profile "${profileName}" not found.`);
  const apiKey = profile.kind === "api-key" || profile.kind === "gateway"
    ? await getApiKey(profile.name)
    : null;
  const env = await buildEnv(profile, apiKey, process.env);
  const bin = process.env.OREODECK_CLAUDE_BIN ?? process.env.CCM_CLAUDE_BIN ?? "claude";

  return new Promise<LaunchResult>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "inherit", env });
    child.on("error", (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`\`${bin}\` not found on PATH. Install Claude Code first.`)
          : err,
      ),
    );
    child.on("close", (code) => resolve({ code: code ?? 0 }));
  });
}
