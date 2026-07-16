import { loadConfig, setFailoverEnabled, setFailoverOrder } from "@ccm/core";

export async function failoverOnCommand(): Promise<void> {
  await setFailoverEnabled(true);
  console.log("Failover enabled.");
}

export async function failoverOffCommand(): Promise<void> {
  await setFailoverEnabled(false);
  console.log("Failover disabled.");
}

export async function failoverOrderCommand(names: string[]): Promise<void> {
  await setFailoverOrder(names);
  const c = await loadConfig();
  console.log(`Failover order: ${c.failoverOrder.join(" → ")}`);
}

export async function failoverShowCommand(): Promise<void> {
  const c = await loadConfig();
  console.log(`Failover: ${c.failoverEnabled ? "on" : "off"}`);
  console.log(`Order: ${c.failoverOrder.join(" → ") || "(none)"}`);
}
