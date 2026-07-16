import { launchClaude, resolveProfileName } from "@ccm/core";

export async function claudeCommand(args: string[], opts: { profile?: string }): Promise<void> {
  const name = await resolveProfileName(opts.profile);
  const { code } = await launchClaude(name, args);
  process.exitCode = code;
}
