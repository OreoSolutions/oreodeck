import { getProfile, setActive } from "@ccm/core";

export async function useCommand(name: string, opts: { tab?: boolean }): Promise<void> {
  if (opts.tab) {
    if (process.env.OREODECK_SHELL_INTEGRATION !== "1") {
      throw new Error(
        "Tab-local profile requires OreoDeck shell integration. Run `oreodeck shell-init >> ~/.zshrc && source ~/.zshrc` first.",
      );
    }
    const profile = await getProfile(name);
    if (!profile) throw new Error(`Profile "${name}" not found.`);
    console.log(`Tab profile is now "${profile.name}".`);
    return;
  }
  await setActive(name);
  console.log(`Active profile is now "${name}".`);
}
