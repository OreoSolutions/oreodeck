import { spawn } from "node:child_process";
import { loadConfig, saveConfig, getProfile } from "./profile-store";
import { buildEnv } from "./launcher";
import { getApiKey } from "./keychain";

const RATE_LIMIT_PATTERNS = [
  /usage limit reached/i,
  /rate[_ ]limit/i,
  /\b429\b/,
];

export function isRateLimitOutput(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

/** Profile kế tiếp trong vòng failover, bỏ qua những profile đã hết limit. */
export function nextProfile(
  current: string,
  order: string[],
  exhausted: Set<string>,
): string | null {
  if (order.length === 0) return null;
  const start = order.indexOf(current);
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(start + i) % order.length];
    if (candidate && !exhausted.has(candidate)) return candidate;
  }
  return null;
}

export async function setFailoverEnabled(on: boolean): Promise<void> {
  const c = await loadConfig();
  c.failoverEnabled = on;
  await saveConfig(c);
}

/**
 * Tên profile trong `names` được so khớp case-insensitive (APFS coi "work"
 * và "Work" là cùng một thư mục — xem profile-store.ts). `failoverOrder`
 * lưu casing gốc (canonical) như trong `config.profiles`, không phải casing
 * người dùng gõ, để mọi nơi khác đọc `failoverOrder` (vd `nextProfile`,
 * `resolveProfileName`) đều so sánh `===` được mà không cần lower-case lại.
 */
export async function setFailoverOrder(names: string[]): Promise<void> {
  const c = await loadConfig();
  const canonicalNames: string[] = [];
  for (const n of names) {
    const lower = n.toLowerCase();
    const match = c.profiles.find((p) => p.name.toLowerCase() === lower);
    if (!match) throw new Error(`Profile "${n}" not found.`);
    canonicalNames.push(match.name);
  }
  // Profile không được liệt kê vẫn giữ ở cuối hàng.
  const listed = new Set(canonicalNames.map((n) => n.toLowerCase()));
  const rest = c.profiles.map((p) => p.name).filter((n) => !listed.has(n.toLowerCase()));
  c.failoverOrder = [...canonicalNames, ...rest];
  await saveConfig(c);
}

/** Chạy claude ở chế độ headless, bắt output để phát hiện rate limit. */
async function runCapturing(
  profileName: string,
  args: string[],
): Promise<{ code: number; output: string }> {
  const profile = await getProfile(profileName);
  if (!profile) throw new Error(`Profile "${profileName}" not found.`);
  const apiKey = profile.kind === "api-key" ? await getApiKey(profileName) : null;
  const env = await buildEnv(profile, apiKey, process.env);
  const bin = process.env.CCM_CLAUDE_BIN ?? "claude";

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["inherit", "pipe", "pipe"], env });
    let output = "";
    child.stdout.on("data", (d) => {
      const s = String(d);
      output += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = String(d);
      output += s;
      process.stderr.write(s);
    });
    child.on("error", (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`\`${bin}\` not found on PATH. Install Claude Code first.`)
          : err,
      ),
    );
    child.on("close", (code) => resolve({ code: code ?? 0, output }));
  });
}

/**
 * Chạy một lệnh headless; nếu chạm rate limit thì tự động chạy lại
 * với profile kế tiếp cho tới khi hết profile.
 */
export async function runHeadlessWithFailover(
  startProfile: string,
  args: string[],
): Promise<{ code: number; profileUsed: string }> {
  const c = await loadConfig();
  const exhausted = new Set<string>();
  let current = startProfile;

  for (;;) {
    const { code, output } = await runCapturing(current, args);
    if (!c.failoverEnabled || !isRateLimitOutput(output)) {
      return { code, profileUsed: current };
    }
    exhausted.add(current);
    const next = nextProfile(current, c.failoverOrder, exhausted);
    if (!next) {
      console.error("All profiles have hit their rate limit.");
      return { code, profileUsed: current };
    }
    console.error(`Profile "${current}" hit its limit — retrying with "${next}".`);
    current = next;
  }
}
