#!/usr/bin/env bun
import { Command } from "commander";
import { listCommand } from "./commands/list";
import { useCommand } from "./commands/use";
import { addCommand } from "./commands/add";
import { removeCommand } from "./commands/remove";
import { claudeCommand } from "./commands/claude";

const program = new Command();

program
  .name("ccm")
  .description("Manage and run multiple Claude accounts side by side")
  .version("0.1.0");

program
  .command("list")
  .description("List profiles")
  .action(listCommand);

program
  .command("use")
  .description("Set the active profile")
  .argument("<name>", "profile name")
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
  .command("claude")
  .description("Run Claude Code with a profile (all extra args are passed through)")
  .option("-P, --profile <name>", "profile to use for this run")
  .allowUnknownOption()
  .argument("[args...]", "arguments forwarded to claude")
  .action(claudeCommand);

// Mọi lỗi ném ra từ command đều in ra stderr và exit 1 — không dump stack trace.
try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
