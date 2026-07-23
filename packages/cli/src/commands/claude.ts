import {
  launchClaude,
  resolveProfileName,
  runHeadlessWithFailover,
  loadConfig,
  nextProfile,
  findSessionForRun,
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
    const launchedAt = Date.now();
    const { code } = await launchClaude(current, runArgs);
    // Phiên tương tác thoát bình thường (0) hoặc do người dùng Ctrl-C (130).
    if (code === 0 || code === 130 || !c.failoverEnabled) {
      process.exitCode = code;
      return;
    }

    // With stdio inherited we deliberately cannot scrape Claude's interactive
    // terminal output without breaking its TTY. A non-zero exit alone is not
    // proof of a usage limit (it can also be auth, network, config, or resume
    // failure), so require an explicit user confirmation before treating this
    // profile as exhausted. Headless mode captures output and detects the
    // limit automatically; this conservative confirmation is interactive-only.
    const next = nextProfile(current, c.failoverOrder, new Set([...exhausted, current]));
    if (!next) {
      process.exitCode = code;
      return;
    }
    const wasRateLimited = await promptConfirm(
      `Claude exited with code ${code}. Confirm a usage limit and continue this conversation on "${next}"?`,
    );
    if (!wasRateLimited) {
      process.exitCode = code;
      return;
    }

    exhausted.add(current);
    const session = await findSessionForRun(current, launchedAt);
    if (session) {
      await copySessionToProfile(session.path, current, next);
      runArgs = ["--resume", session.id];
      console.log(`Resuming session ${session.id} on "${next}".`);
    } else {
      runArgs = args;
      console.log(`No unambiguous session from this run to carry over — starting fresh on "${next}".`);
    }
    current = next;
  }
}
