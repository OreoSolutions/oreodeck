import { setActive } from "@ccm/core";

export async function useCommand(name: string): Promise<void> {
  await setActive(name);
  console.log(`Active profile is now "${name}".`);
}
