import { spawn } from "node:child_process";
import { cp, mkdir, open, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { loadConfig, updateConfig, getProfile } from "./profile-store";
import { buildEnv } from "./launcher";
import { getApiKey } from "./keychain";
import { globalClaudeDir, profileDir } from "./paths";

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
  await updateConfig((c) => { c.failoverEnabled = on; });
}

/**
 * Tên profile trong `names` được so khớp case-insensitive (APFS coi "work"
 * và "Work" là cùng một thư mục — xem profile-store.ts). `failoverOrder`
 * lưu casing gốc (canonical) như trong `config.profiles`, không phải casing
 * người dùng gõ, để mọi nơi khác đọc `failoverOrder` (vd `nextProfile`,
 * `resolveProfileName`) đều so sánh `===` được mà không cần lower-case lại.
 */
export async function setFailoverOrder(names: string[]): Promise<void> {
  await updateConfig((c) => {
    const canonicalNames: string[] = [];
    for (const n of names) {
      const lower = n.toLowerCase();
      const match = c.profiles.find((p) => p.name.toLowerCase() === lower);
      if (!match) throw new Error(`Profile "${n}" not found.`);
      if (!canonicalNames.some((x) => x.toLowerCase() === lower)) canonicalNames.push(match.name);
    }
    const listed = new Set(canonicalNames.map((n) => n.toLowerCase()));
    const rest = c.profiles.map((p) => p.name).filter((n) => !listed.has(n.toLowerCase()));
    c.failoverOrder = [...canonicalNames, ...rest];
  });
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
  const bin = process.env.OREODECK_CLAUDE_BIN ?? process.env.CCM_CLAUDE_BIN ?? "claude";

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

export interface SharedSession {
  id: string;
  path: string;
  source: string;
  project: string;
  preview: string;
  mtime: number;
}

async function sessionSummary(path: string): Promise<{ project: string; preview: string }> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    let project = "Unknown project";
    let preview = "Claude session";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (typeof row.cwd === "string") project = row.cwd;
        const message = row.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (message?.role === "user") {
          if (typeof content === "string") preview = content;
          else if (Array.isArray(content)) {
            const text = content.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
            if (typeof text?.text === "string") preview = text.text;
          }
          if (preview !== "Claude session") break;
        }
      } catch { /* Ignore partial/non-JSON transcript lines. */ }
    }
    return { project, preview: preview.replace(/\s+/g, " ").trim().slice(0, 90) || "Claude session" };
  } finally {
    await handle.close();
  }
}

async function walkAllSessions(d: string): Promise<SessionCandidate[]> {
  let items;
  try { items = await readdir(d, { withFileTypes: true }); } catch { return []; }
  const found: SessionCandidate[] = [];
  for (const item of items) {
    if (item.name === "subagents") continue;
    const path = join(d, item.name);
    if (item.isDirectory()) found.push(...await walkAllSessions(path));
    else if (item.isFile() && item.name.endsWith(".jsonl") && !item.name.startsWith("agent-")) {
      found.push({ id: item.name.slice(0, -6), path, mtime: (await stat(path)).mtimeMs });
    }
  }
  return found;
}

/** Sessions available outside the destination profile, newest first. */
export async function listImportableSessions(destinationProfile: string): Promise<SharedSession[]> {
  const config = await loadConfig();
  const sources = [
    { name: "global", root: globalClaudeDir() },
    ...config.profiles.filter((p) => p.name.toLowerCase() !== destinationProfile.toLowerCase())
      .map((p) => ({ name: p.name, root: profileDir(p.name) })),
  ];
  const sessions: SharedSession[] = [];
  for (const source of sources) {
    for (const candidate of await walkAllSessions(join(source.root, "projects"))) {
      const summary = await sessionSummary(candidate.path);
      sessions.push({ ...candidate, source: source.name, ...summary });
    }
  }
  return sessions.sort((a, b) => b.mtime - a.mtime);
}

export async function importSessionToProfile(session: SharedSession, destinationProfile: string): Promise<void> {
  const sourceRoot = session.source === "global" ? globalClaudeDir() : profileDir(session.source);
  const rel = relative(sourceRoot, session.path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Session path is outside its source profile.");
  const destination = join(profileDir(destinationProfile), rel);
  await mkdir(dirname(destination), { recursive: true });
  await cp(session.path, destination, { force: false, errorOnExist: true });
}

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

async function walkForSessionsModifiedSince(d: string, since: number): Promise<SessionCandidate[]> {
  let items;
  try { items = await readdir(d, { withFileTypes: true }); } catch { return []; }
  const found: SessionCandidate[] = [];
  for (const it of items) {
    const p = join(d, it.name);
    if (it.isDirectory()) {
      found.push(...await walkForSessionsModifiedSince(p, since));
    } else if (it.isFile() && it.name.endsWith(".jsonl")) {
      const mtime = (await stat(p)).mtimeMs;
      if (mtime >= since) found.push({ id: it.name.replace(/\.jsonl$/, ""), path: p, mtime });
    }
  }
  return found;
}

/** Tìm transcript được sửa gần nhất của một profile — đó là session đang chạy. */
export async function findLatestSession(
  profileName: string,
): Promise<{ id: string; path: string } | null> {
  const root = join(profileDir(profileName), "projects");
  const found = await walkForLatestSession(root);
  return found ? { id: found.id, path: found.path } : null;
}

/**
 * Identifies the transcript belonging to one wrapper run without guessing.
 * Exactly one transcript must have changed since launch; zero means Claude did
 * not create one, and multiple means another parallel session makes the owner
 * ambiguous. In both unsafe cases callers start fresh instead of copying the
 * wrong conversation into another account.
 */
export async function findSessionForRun(
  profileName: string,
  launchedAt: number,
): Promise<{ id: string; path: string } | null> {
  const root = join(profileDir(profileName), "projects");
  const found = await walkForSessionsModifiedSince(root, launchedAt);
  return found.length === 1 ? { id: found[0]!.id, path: found[0]!.path } : null;
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
