import { loadConfig, readClaudePlanUsage, readProfileUsage } from "@ccm/core";

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
  const date = new Date(resetAt);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return date.toLocaleString([], sameDay
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtAge(fetchedAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export interface PlanRow {
  profile: string;
  limit: string;
  used: string;
  reset: string;
  updated: string;
}

export function renderPlanUsageTable(rows: PlanRow[]): string[] {
  const columns: Array<{ key: keyof PlanRow; header: string }> = [
    { key: "profile", header: "PROFILE" },
    { key: "limit", header: "LIMIT" },
    { key: "used", header: "USED" },
    { key: "reset", header: "RESET" },
    { key: "updated", header: "UPDATED" },
  ];
  const displayRows = rows.map((row) => ({ ...row, limit: truncate(row.limit, 20) }));
  const fixedColumns = columns.filter((column) => column.key !== "profile");
  const fixedWidths = fixedColumns.map((column) =>
    Math.max(column.header.length, ...displayRows.map((row) => row[column.key].length)),
  );
  const profileBudget = Math.max(
    "PROFILE".length,
    TABLE_WIDTH - (columns.length - 1) * 2 - fixedWidths.reduce((sum, width) => sum + width, 0),
  );
  const normalizedRows = displayRows.map((row) => ({
    ...row,
    profile: truncate(row.profile, profileBudget),
  }));
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...normalizedRows.map((row) => row[column.key].length)),
  );
  return [
    columns.map((column, index) => column.header.padEnd(widths[index]!)).join("  ").trimEnd(),
    ...normalizedRows.map((row) => columns.map((column, index) =>
      row[column.key].padEnd(widths[index]!),
    ).join("  ").trimEnd()),
  ];
}

function pad(text: string, width: number, align: "left" | "right"): string {
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

// Hard cap on total table width. NAME_RE (packages/core/src/profile-store.ts)
// allows profile names up to 64 chars, and the profile column otherwise
// grows 1:1 with the name, so an unbounded PROFILE column blows past any
// terminal width for long-but-legal names. Truncating is display-only: the
// stored name (ProfileUsage, config.json) never changes.
const TABLE_WIDTH = 80;
const ELLIPSIS = "…";

/**
 * Shortens `text` to at most `maxWidth` visible characters, replacing the
 * last one with an ellipsis when truncation happens, so the user can always
 * tell a name was cut rather than mistaking it for the full value.
 */
function truncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= ELLIPSIS.length) return ELLIPSIS.slice(0, Math.max(maxWidth, 0));
  return `${text.slice(0, maxWidth - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * Pure renderer: rows -> lines (header first). Column widths self-adjust to
 * the widest cell (header or data) per column, same as before. Split out
 * from statusCommand so width can be measured directly against worst-case
 * inputs in tests, without going through config/usage I/O.
 *
 * The PROFILE column is the exception: it is truncated (with a trailing
 * "…") to whatever width remains after every other column and separator
 * claims its space, so the rendered table never exceeds TABLE_WIDTH
 * columns regardless of profile name length (1-64 chars, see NAME_RE).
 */
export function renderUsageTable(rows: Row[]): string[] {
  const numericColumns = COLUMNS.filter((col) => col.key !== "profile");
  const numericWidths = numericColumns.map((col) =>
    Math.max(col.header.length, ...rows.map((r) => r[col.key].length)),
  );
  const separatorsWidth = COLUMNS.length - 1; // one COLUMN_SEPARATOR between each pair
  const profileHeaderWidth = COLUMNS[0]!.header.length; // "PROFILE"
  const profileBudget = Math.max(
    profileHeaderWidth,
    TABLE_WIDTH - separatorsWidth - numericWidths.reduce((sum, w) => sum + w, 0),
  );

  const displayRows = rows.map((r) => ({ ...r, profile: truncate(r.profile, profileBudget) }));

  const widths = COLUMNS.map((col) =>
    Math.max(col.header.length, ...displayRows.map((r) => r[col.key].length)),
  );

  const headerLine = COLUMNS.map((col, i) => pad(col.header, widths[i]!, col.align))
    .join(COLUMN_SEPARATOR)
    .trimEnd();

  const rowLines = displayRows.map((row) =>
    COLUMNS.map((col, i) => pad(row[col.key], widths[i]!, col.align))
      .join(COLUMN_SEPARATOR)
      .trimEnd(),
  );

  return [headerLine, ...rowLines];
}

export async function statusCommand(): Promise<void> {
  const c = await loadConfig();
  if (c.profiles.length === 0) {
    console.log("No profiles yet. Create one with `oreodeck add <name>`.");
    return;
  }

  const subscriptionProfiles = c.profiles.filter((profile) => profile.kind === "subscription");
  if (subscriptionProfiles.length > 0) {
    const planRows = (await Promise.all(subscriptionProfiles.map(async (profile) => {
      const usage = await readClaudePlanUsage(profile.name);
      const marker = profile.name === c.active ? "*" : " ";
      if (!usage || usage.limits.length === 0) {
        return [{
          profile: `${marker} ${profile.name}`,
          limit: "Account",
          used: "—",
          reset: "—",
          updated: "no cache",
        }];
      }
      return usage.limits.map((limit, index) => ({
        profile: index === 0 ? `${marker} ${profile.name}` : "",
        limit: limit.active ? `${limit.label} *` : limit.label,
        used: `${Math.round(limit.utilization)}%`,
        reset: fmtReset(limit.resetAt),
        updated: fmtAge(usage.fetchedAt),
      }));
    }))).flat();
    console.log("CLAUDE PLAN USAGE");
    for (const line of renderPlanUsageTable(planRows)) console.log(line);
  }

  const apiProfiles = c.profiles.filter((profile) => profile.kind === "api-key");
  if (apiProfiles.length > 0) {
    const rows: Row[] = await Promise.all(apiProfiles.map(async (p) => {
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
        cost: `$${usage.costUsd.toFixed(2)}`,
        // API-key profiles are pay-as-you-go and do not have a subscription
        // reset window. Transcript timestamps must not invent one.
        reset: "—",
      };
    }));

    if (subscriptionProfiles.length > 0) console.log("");
    console.log("LOCAL API USAGE (LAST 5 HOURS)");
    for (const line of renderUsageTable(rows)) console.log(line);
  }

  if (subscriptionProfiles.length > 0) {
    console.log("\nPlan percentages and resets come from Claude's per-account usage cache. Run /usage in Claude to refresh it.");
  }
}
