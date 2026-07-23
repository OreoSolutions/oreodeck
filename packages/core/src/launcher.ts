import { spawn } from "node:child_process";
import { profileDir } from "./paths";
import { getApiKey } from "./keychain";
import { getProfile, type Profile } from "./profile-store";
import { syncSharedConfiguration } from "./shared-config";

export interface LaunchResult {
  code: number;
}

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
  const env: NodeJS.ProcessEnv = { ...base };
  env.CLAUDE_CONFIG_DIR = profileDir(profile.name);
  if (profile.kind === "api-key") {
    if (!apiKey) throw new Error(`No API key stored for profile "${profile.name}".`);
    env.ANTHROPIC_API_KEY = apiKey;
  } else {
    // Một ANTHROPIC_API_KEY thừa kế từ shell sẽ lấn át OAuth login của profile.
    delete env.ANTHROPIC_API_KEY;
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
  const apiKey = profile.kind === "api-key" ? await getApiKey(profile.name) : null;
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
