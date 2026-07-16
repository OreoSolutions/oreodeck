import { loadConfig, readProfileUsage } from "@ccm/core";

export interface Row {
  profile: string;
  total: string;
  input: string;
  cacheWrite: string;
  cacheRead: string;
  output: string;
  cost: string;
  reset: string;
}

// Kept to a single space between columns (rather than the more common
// two-space table gutter) so a 12-char profile name plus 7-figure token
// counts in every numeric column still fits within an 80-column terminal —
// see packages/cli/src/commands/status.test.ts for the width regression.
const COLUMN_SEPARATOR = " ";

const COLUMNS: { key: keyof Row; header: string; align: "left" | "right" }[] = [
  { key: "profile", header: "PROFILE", align: "left" },
  // TOTAL comes first among the numeric columns — it's the headline number.
  { key: "total", header: "TOTAL", align: "right" },
  { key: "input", header: "INPUT", align: "right" },
  // Cache-write is a single displayed column: the 5m/1h split matters for
  // cost arithmetic (kept in ProfileUsage), not for an at-a-glance table.
  { key: "cacheWrite", header: "CACHE-W", align: "right" },
  { key: "cacheRead", header: "CACHE-R", align: "right" },
  { key: "output", header: "OUTPUT", align: "right" },
  { key: "cost", header: "COST", align: "right" },
  { key: "reset", header: "RESET", align: "left" },
];

function fmtReset(resetAt: number | null): string {
  if (resetAt === null) return "—";
  return new Date(resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function pad(text: string, width: number, align: "left" | "right"): string {
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

/**
 * Pure renderer: rows -> lines (header first). Column widths self-adjust to
 * the widest cell (header or data) per column, same as before. Split out
 * from statusCommand so width can be measured directly against worst-case
 * inputs in tests, without going through config/usage I/O.
 */
export function renderUsageTable(rows: Row[]): string[] {
  const widths = COLUMNS.map((col) =>
    Math.max(col.header.length, ...rows.map((r) => r[col.key].length)),
  );

  const headerLine = COLUMNS.map((col, i) => pad(col.header, widths[i]!, col.align))
    .join(COLUMN_SEPARATOR)
    .trimEnd();

  const rowLines = rows.map((row) =>
    COLUMNS.map((col, i) => pad(row[col.key], widths[i]!, col.align))
      .join(COLUMN_SEPARATOR)
      .trimEnd(),
  );

  return [headerLine, ...rowLines];
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
      const marker = p.name === c.active ? "*" : " ";
      return {
        profile: `${marker} ${p.name}`,
        total: usage.totalTokens.toLocaleString(),
        input: usage.inputTokens.toLocaleString(),
        cacheWrite: (usage.cacheWrite5mTokens + usage.cacheWrite1hTokens).toLocaleString(),
        cacheRead: usage.cacheReadTokens.toLocaleString(),
        output: usage.outputTokens.toLocaleString(),
        // A subscription profile's usage is not billed per token, so there
        // is nothing meaningful to estimate — only api-key profiles pay
        // per-token.
        cost: p.kind === "api-key" ? `$${usage.costUsd.toFixed(2)}` : "—",
        reset: fmtReset(usage.resetAt),
      };
    }),
  );

  for (const line of renderUsageTable(rows)) {
    console.log(line);
  }

  console.log("\nNumbers cover the current 5-hour rate-limit window.");
}
