import { expect, test } from "bun:test";
import { renderUsageTable, type Row } from "./status";

/**
 * Worst-case row per the brief: a 12-char profile name and a 7-figure count
 * in every numeric column, including cache-write collapsed into one column
 * and a plausible worst-case api-key cost. Every line — header included —
 * must fit within an 80-column terminal.
 */
function worstCaseRow(): Row {
  const sevenFigures = (9_999_999).toLocaleString(); // "9,999,999" — 9 chars
  // TOTAL sums input + cache-write + cache-read + output, so when every one
  // of those is independently 7-figure (as required by the brief), TOTAL
  // itself spills into 8 figures — "39,999,996" is 10 chars, wider than any
  // single component column. Use that real worst case rather than an
  // artificially narrower 7-figure TOTAL.
  const eightFigureTotal = (39_999_996).toLocaleString();
  return {
    profile: `* ${"a".repeat(12)}`,
    total: eightFigureTotal,
    input: sevenFigures,
    cacheWrite: sevenFigures,
    cacheRead: sevenFigures,
    output: sevenFigures,
    cost: "$9999.99",
    reset: "23:59",
  };
}

test("status table stays within 80 columns for a 12-char profile name and 7-figure counts", () => {
  const lines = renderUsageTable([worstCaseRow()]);
  expect(lines.length).toBe(2); // header + one row
  for (const line of lines) {
    expect(line.length).toBeLessThanOrEqual(80);
  }
});

test("status table keeps cache-write5m/1h collapsed into a single displayed column", () => {
  const [header] = renderUsageTable([worstCaseRow()]);
  expect(header).toContain("CACHE-W");
  expect(header).not.toContain("CACHE-W5M");
  expect(header).not.toContain("CACHE-W1H");
});

test("status table keeps TOTAL as the first numeric column after profile", () => {
  const [header] = renderUsageTable([worstCaseRow()]);
  const headerCols = header!.trim().split(/\s+/);
  expect(headerCols[0]).toBe("PROFILE");
  expect(headerCols[1]).toBe("TOTAL");
});

test("status table renders the active marker and profile name together", () => {
  const [, row] = renderUsageTable([worstCaseRow()]);
  expect(row).toMatch(/^\*\s+aaaaaaaaaaaa/);
});
