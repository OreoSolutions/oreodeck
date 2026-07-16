import { loadConfig, readProfileUsage } from "@ccm/core";

interface Row {
  marker: string;
  name: string;
  input: string;
  cacheWrite5m: string;
  cacheWrite1h: string;
  cacheRead: string;
  output: string;
  total: string;
  reset: string;
  cost: string;
}

const COLUMNS: { key: keyof Row; header: string; align: "left" | "right" }[] = [
  { key: "marker", header: " ", align: "left" },
  { key: "name", header: "PROFILE", align: "left" },
  { key: "input", header: "INPUT", align: "right" },
  { key: "cacheWrite5m", header: "CACHE-W5M", align: "right" },
  { key: "cacheWrite1h", header: "CACHE-W1H", align: "right" },
  { key: "cacheRead", header: "CACHE-READ", align: "right" },
  { key: "output", header: "OUTPUT", align: "right" },
  { key: "total", header: "TOTAL", align: "right" },
  { key: "reset", header: "RESET", align: "left" },
  { key: "cost", header: "COST", align: "right" },
];

function fmtReset(resetAt: number | null): string {
  if (resetAt === null) return "—";
  return new Date(resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function pad(text: string, width: number, align: "left" | "right"): string {
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

export async function statusCommand(): Promise<void> {
  const c = await loadConfig();
  if (c.profiles.length === 0) {
    console.log("No profiles yet. Create one with `ccm add <name>`.");
    return;
  }

  const rows: Row[] = await Promise.all(
    c.profiles.map(async (p) => {
      const usage = await readProfileUsage(p.name);
      return {
        marker: p.name === c.active ? "*" : " ",
        name: p.name,
        input: usage.inputTokens.toLocaleString(),
        cacheWrite5m: usage.cacheWrite5mTokens.toLocaleString(),
        cacheWrite1h: usage.cacheWrite1hTokens.toLocaleString(),
        cacheRead: usage.cacheReadTokens.toLocaleString(),
        output: usage.outputTokens.toLocaleString(),
        total: usage.totalTokens.toLocaleString(),
        reset: fmtReset(usage.resetAt),
        // A subscription profile's usage is not billed per token, so there
        // is nothing meaningful to estimate — only api-key profiles pay
        // per-token.
        cost: p.kind === "api-key" ? `$${usage.costUsd.toFixed(2)}` : "—",
      };
    }),
  );

  const widths = COLUMNS.map((col) =>
    Math.max(col.header.length, ...rows.map((r) => r[col.key].length)),
  );

  const headerLine = COLUMNS.map((col, i) => pad(col.header, widths[i]!, col.align)).join("  ");
  console.log(headerLine.trimEnd());

  for (const row of rows) {
    const line = COLUMNS.map((col, i) => pad(row[col.key], widths[i]!, col.align)).join("  ");
    console.log(line.trimEnd());
  }

  console.log("\nNumbers cover the current 5-hour rate-limit window.");
}
