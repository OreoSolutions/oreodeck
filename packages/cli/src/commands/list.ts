import { loadConfig } from "@ccm/core";

export async function listCommand(): Promise<void> {
  const c = await loadConfig();
  if (c.profiles.length === 0) {
    console.log("No profiles yet. Create one with `ccm add <name>`.");
    return;
  }
  for (const p of c.profiles) {
    const marker = p.name === c.active ? "*" : " ";
    console.log(`${marker} ${p.name.padEnd(20)} ${p.kind}`);
  }
}
