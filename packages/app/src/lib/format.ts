import type { ProfileUsageView } from "./api";

/** Countdown text for a 5h usage window reset, shared by UsageTab and ProfilesTab. */
export function formatCountdown(resetAt: number | null, now: number): string {
  if (resetAt === null) return "—";
  const ms = resetAt - now;
  if (ms <= 0) return "resetting";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/** Cost text: dollar amount for api-key profiles, "—" for subscription (Phase 1 CLI convention). */
export function formatCost(usage: Pick<ProfileUsageView, "kind" | "costUsd">): string {
  return usage.kind === "api-key" ? `$${usage.costUsd.toFixed(2)}` : "—";
}
