#!/usr/bin/env bun
import { Command } from "commander";
import { listCommand } from "./commands/list";
import { useCommand } from "./commands/use";
import { addCommand } from "./commands/add";
import { removeCommand } from "./commands/remove";
import { claudeCommand } from "./commands/claude";
import { statusCommand } from "./commands/status";
import {
  failoverOnCommand,
  failoverOffCommand,
  failoverOrderCommand,
  failoverShowCommand,
} from "./commands/failover";
import { shellInitCommand } from "./commands/shell-init";
import { sharedClearCommand, sharedSetCommand, sharedShowCommand, sharedChoices } from "./commands/shared";
import { uninstallCommand } from "./commands/uninstall";
import { uiInstallCommand, uiOpenCommand, uiRemoveCommand } from "./commands/ui";
import { sessionsCommand } from "./commands/sessions";
import { maybePromptForUpdate, updateCommand } from "./update";
import { OREODECK_VERSION } from "./version";

const program = new Command();

program
  .name("oreodeck")
  .description("Manage and run multiple Claude accounts side by side")
  .version(OREODECK_VERSION);

program
  .command("update")
  .description("Check for and install a verified OreoDeck update")
  .option("--check", "only check whether an update is available")
  .option("-y, --yes", "install without asking for confirmation")
  .action(updateCommand);

program
  .command("list")
  .description("List profiles")
  .action(listCommand);

program
  .command("use")
  .description("Set the active profile")
  .argument("<name>", "profile name")
  .option("-t, --tab", "use this profile only in the current terminal tab")
  .action(useCommand);

program
  .command("add")
  .description("Add a profile (subscription by default)")
  .argument("<name>", "profile name")
  .option("--api-key", "create an API key profile instead of a subscription login")
  .action(addCommand);

program
  .command("remove")
  .description("Remove a profile and its data")
  .argument("<name>", "profile name")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(removeCommand);

program
  .command("run")
  .alias("claude")
  .description("Run Claude Code with a profile (all extra args are passed through)")
  .option("-P, --profile <name>", "profile to use for this run")
  .allowUnknownOption()
  .argument("[args...]", "arguments forwarded to claude")
  .action(claudeCommand);

program
  .command("sessions")
  .description("Pick a session from global or another profile and resume it here")
  .option("-P, --profile <name>", "destination profile (defaults to this tab or active profile)")
  .option("--from <source>", "only show sessions from global or one profile")
  .option("-l, --list", "list available sessions without importing")
  .action(sessionsCommand);

program
  .command("status")
  .description("Show token usage per profile for the current 5-hour window")
  .action(statusCommand);

const failover = program.command("failover").description("Configure automatic failover");
failover.command("on").description("Enable failover").action(failoverOnCommand);
failover.command("off").description("Disable failover").action(failoverOffCommand);
failover
  .command("order")
  .description("Set the failover order")
  .argument("<names...>", "profile names, in order")
  .action(failoverOrderCommand);
failover.command("show", { isDefault: true }).description("Show failover settings").action(failoverShowCommand);

program
  .command("shell-init")
  .description("Print a shell snippet that routes `claude` through OreoDeck")
  .action(shellInitCommand);

program
  .command("uninstall")
  .description("Remove OreoDeck from this Mac")
  .option("--purge", "also permanently delete every profile and stored API key")
  .option("-y, --yes", "skip the confirmation prompt")
  .action(uninstallCommand);

const ui = program.command("ui").description("Install or manage the optional OreoDeck app");
ui.command("install", { isDefault: true }).description("Install the optional macOS app").action(uiInstallCommand);
ui.command("open").description("Open the installed macOS app").action(uiOpenCommand);
ui.command("remove").description("Remove only the macOS app").action(uiRemoveCommand);

const shared = program.command("shared").description("Share selected ~/.claude resources with a profile");
shared.command("show").argument("<profile>").action(sharedShowCommand);
shared.command("set")
  .argument("<profile>")
  .argument("[resources...]", `optional for automation; allowed: ${sharedChoices()}`)
  .option("-f, --force", "replace conflicting local resources after confirmation")
  .option("-y, --yes", "confirm replacement without prompting (requires --force)")
  .action(sharedSetCommand);
shared.command("clear").argument("<profile>").action(sharedClearCommand);

// F-7: bare `ccm` (no args at all) should behave like `--help` — print help
// and exit 0 — rather than commander's default "missing subcommand" path,
// which calls `this.help({ error: true })` internally and exits 1 (a
// synchronous process.exit(), so it can't be caught below). Intercepting
// here, before parseAsync ever runs, only touches the truly-empty-args
// case: `--help`/`-h` still go through commander's normal (exit 0) path,
// and an unknown command like `ccm bogus` still reaches commander's
// unknownCommand() handling (exit 1) since argv has at least one operand.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

// Mọi lỗi ném ra từ command đều in ra stderr và exit 1 — không dump stack trace.
try {
  await maybePromptForUpdate(process.argv.slice(2));
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
