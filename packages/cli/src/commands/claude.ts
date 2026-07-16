import {
  launchClaude,
  resolveProfileName,
  runHeadlessWithFailover,
  loadConfig,
  nextProfile,
  findLatestSession,
  copySessionToProfile,
} from "@ccm/core";
import { promptConfirm } from "../prompt";

/** `claude -p "..."` là chế độ headless — bắt được output nên failover tự động được. */
function isHeadless(args: string[]): boolean {
  return args.includes("-p") || args.includes("--print");
}

export async function claudeCommand(args: string[], opts: { profile?: string }): Promise<void> {
  const start = await resolveProfileName(opts.profile);

  if (isHeadless(args)) {
    const { code } = await runHeadlessWithFailover(start, args);
    process.exitCode = code;
    return;
  }

  const c = await loadConfig();
  const exhausted = new Set<string>();
  let current = start;
  let runArgs = args;

  for (;;) {
    const { code } = await launchClaude(current, runArgs);
    // Phiên tương tác thoát bình thường (0) hoặc do người dùng Ctrl-C (130).
    if (code === 0 || code === 130 || !c.failoverEnabled) {
      process.exitCode = code;
      return;
    }

    exhausted.add(current);
    const next = nextProfile(current, c.failoverOrder, exhausted);
    if (!next) {
      console.error("All profiles have hit their rate limit.");
      process.exitCode = code;
      return;
    }

    const ok = await promptConfirm(
      `Profile "${current}" may have hit its limit. Continue this conversation on "${next}"?`,
    );
    if (!ok) {
      process.exitCode = code;
      return;
    }

    const session = await findLatestSession(current);
    if (session) {
      await copySessionToProfile(session.path, current, next);
      runArgs = ["--resume", session.id];
      console.log(`Resuming session ${session.id} on "${next}".`);
    } else {
      runArgs = args;
      console.log(`No session to carry over — starting fresh on "${next}".`);
    }
    current = next;
  }
}
