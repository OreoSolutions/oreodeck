import { launchClaude, resolveProfileName, runHeadlessWithFailover } from "@ccm/core";

/** `claude -p "..."` là chế độ headless — bắt được output nên failover tự động được. */
function isHeadless(args: string[]): boolean {
  return args.includes("-p") || args.includes("--print");
}

export async function claudeCommand(args: string[], opts: { profile?: string }): Promise<void> {
  const name = await resolveProfileName(opts.profile);
  if (isHeadless(args)) {
    const { code } = await runHeadlessWithFailover(name, args);
    process.exitCode = code;
    return;
  }
  const { code } = await launchClaude(name, args);
  process.exitCode = code;
}
