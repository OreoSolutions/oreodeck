#!/usr/bin/env bun
import { Command } from "commander";
import { listCommand } from "./commands/list";
import { useCommand } from "./commands/use";

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

// Mọi lỗi ném ra từ command đều in ra stderr và exit 1 — không dump stack trace.
try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
