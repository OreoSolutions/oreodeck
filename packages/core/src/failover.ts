import { spawn } from "node:child_process";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { loadConfig, saveConfig, getProfile } from "./profile-store";
import { buildEnv } from "./launcher";
import { getApiKey } from "./keychain";
import { profileDir } from "./paths";

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

type SessionCandidate = { id: string; path: string; mtime: number };

// Đệ quy trả về "best" thay vì gán vào biến ở scope ngoài: TS mất khả năng
// narrow một `let` bị gán bên trong closure lồng nhau (đọc lại ở scope
// ngoài sau `await walk(...)` báo lỗi "never" dù type đã annotate rõ ràng
// — xem repro trong PR). Trả giá trị ra ngoài tránh hẳn vấn đề đó.
async function walkForLatestSession(d: string): Promise<SessionCandidate | null> {
  let items;
  try {
    items = await readdir(d, { withFileTypes: true });
  } catch {
    return null;
  }
  let best: SessionCandidate | null = null;
  for (const it of items) {
    const p = join(d, it.name);
    if (it.isDirectory()) {
      const found = await walkForLatestSession(p);
      if (found && (!best || found.mtime > best.mtime)) best = found;
    } else if (it.name.endsWith(".jsonl")) {
      const m = (await stat(p)).mtimeMs;
      if (!best || m > best.mtime) {
        best = { id: it.name.replace(/\.jsonl$/, ""), path: p, mtime: m };
      }
    }
  }
  return best;
}

/** Tìm transcript được sửa gần nhất của một profile — đó là session đang chạy. */
export async function findLatestSession(
  profileName: string,
): Promise<{ id: string; path: string } | null> {
  const root = join(profileDir(profileName), "projects");
  const found = await walkForLatestSession(root);
  return found ? { id: found.id, path: found.path } : null;
}

/** Copy transcript sang profile khác, giữ nguyên đường dẫn tương đối để --resume tìm thấy. */
export async function copySessionToProfile(
  sessionPath: string,
  fromProfile: string,
  toProfile: string,
): Promise<void> {
  const rel = relative(profileDir(fromProfile), sessionPath);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Session path is outside profile "${fromProfile}".`);
  }
  const dest = join(profileDir(toProfile), rel);
  await mkdir(dirname(dest), { recursive: true });
  await cp(sessionPath, dest);
}
