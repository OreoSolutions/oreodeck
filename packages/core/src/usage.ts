import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { profileDir } from "./paths";

/** Độ dài cửa sổ rate-limit 5 giờ của Claude Code. */
export const WINDOW_MS = 5 * 60 * 60 * 1000;

export interface UsageEntry {
  timestamp: number;
  model: string;
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface ProfileUsage {
  profile: string;
  entries: number;
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** Every token the model actually processed — this is what counts against rate limits. */
  totalTokens: number;
  costUsd: number;
  windowStart: number;
  /** When the current 5-hour window resets, or null if there was no activity in it. */
  resetAt: number | null;
}

/** USD per 1M tokens. Cache multipliers below apply to `input`, never `output`. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },
};

const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;
const CACHE_READ_MULTIPLIER = 0.1;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Một dòng transcript của Claude Code. Chỉ dòng `type === "assistant"` có
 * `message.usage` mới tạo ra một UsageEntry — mọi thứ khác (user, summary,
 * JSON hỏng, dòng trống, timestamp không parse được) trả về null chứ
 * không bao giờ throw, vì một transcript nửa vời không được phép làm sập
 * cả report.
 */
export function parseTranscriptLine(line: string): UsageEntry | null {
  if (!line.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== "assistant") return null;

  const message = obj.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  const timestamp = Date.parse(String(obj.timestamp));
  if (Number.isNaN(timestamp)) return null;

  const cacheCreation = usage.cache_creation as Record<string, unknown> | undefined;
  let cacheWrite5mTokens: number;
  let cacheWrite1hTokens: number;
  if (cacheCreation) {
    cacheWrite5mTokens = num(cacheCreation.ephemeral_5m_input_tokens);
    cacheWrite1hTokens = num(cacheCreation.ephemeral_1h_input_tokens);
  } else {
    // No breakdown available — treat the whole amount as the cheaper,
    // more common 5-minute TTL rather than guessing at 1-hour pricing.
    cacheWrite5mTokens = num(usage.cache_creation_input_tokens);
    cacheWrite1hTokens = 0;
  }

  return {
    timestamp,
    model: typeof message?.model === "string" ? message.model : "",
    inputTokens: num(usage.input_tokens),
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    cacheReadTokens: num(usage.cache_read_input_tokens),
    outputTokens: num(usage.output_tokens),
  };
}

/**
 * Cache multipliers apply to the model's INPUT rate, never the output rate —
 * a write or read of a cache entry is still processing input tokens, just at
 * a discounted (read) or premium (write) rate depending on TTL.
 */
export function estimateCostUsd(entry: UsageEntry): number {
  const price = PRICING[entry.model];
  if (!price) return 0;
  const cost =
    entry.inputTokens * price.input +
    entry.cacheWrite5mTokens * price.input * CACHE_WRITE_5M_MULTIPLIER +
    entry.cacheWrite1hTokens * price.input * CACHE_WRITE_1H_MULTIPLIER +
    entry.cacheReadTokens * price.input * CACHE_READ_MULTIPLIER +
    entry.outputTokens * price.output;
  return cost / 1_000_000;
}

/** Tìm mọi file *.jsonl dưới `<profileDir>/projects/` (đệ quy). Thư mục thiếu -> mảng rỗng. */
async function listTranscriptFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await listTranscriptFiles(full)));
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Đọc toàn bộ transcript của một profile và cộng dồn token trong cửa sổ
 * 5 giờ hiện tại. Không bao giờ throw: profile chưa chạy lần nào (không có
 * thư mục `projects/`) hoặc một file transcript hỏng/không đọc được đều
 * chỉ đóng góp 0, vì `ccm status` liệt kê mọi profile và một file lỗi
 * không được phép làm hỏng cả report.
 */
export async function readProfileUsage(profileName: string, now = Date.now()): Promise<ProfileUsage> {
  const windowStart = now - WINDOW_MS;
  const projectsDir = join(profileDir(profileName), "projects");
  const files = await listTranscriptFiles(projectsDir);

  const entries: UsageEntry[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => "");
    for (const line of content.split("\n")) {
      const entry = parseTranscriptLine(line);
      if (entry && entry.timestamp >= windowStart && entry.timestamp <= now) {
        entries.push(entry);
      }
    }
  }

  const usage: ProfileUsage = {
    profile: profileName,
    entries: entries.length,
    inputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    windowStart,
    resetAt: null,
  };

  let earliest: number | null = null;
  for (const entry of entries) {
    usage.inputTokens += entry.inputTokens;
    usage.cacheWrite5mTokens += entry.cacheWrite5mTokens;
    usage.cacheWrite1hTokens += entry.cacheWrite1hTokens;
    usage.cacheReadTokens += entry.cacheReadTokens;
    usage.outputTokens += entry.outputTokens;
    usage.costUsd += estimateCostUsd(entry);
    if (earliest === null || entry.timestamp < earliest) earliest = entry.timestamp;
  }
  usage.totalTokens =
    usage.inputTokens +
    usage.cacheWrite5mTokens +
    usage.cacheWrite1hTokens +
    usage.cacheReadTokens +
    usage.outputTokens;
  usage.resetAt = earliest === null ? null : earliest + WINDOW_MS;

  return usage;
}
