import { mkdir, rename, writeFile, readFile, unlink, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Ghi JSON an toàn: ghi file tạm cùng thư mục rồi rename.
 * rename trong cùng filesystem là atomic, nên hai tiến trình ccm chạy song song
 * không bao giờ đọc được file ghi dở.
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

/**
 * Cross-process lock shared with the Rust core. `mkdir` is atomic on APFS,
 * unlike an atomic config rename which only prevents torn JSON and does not
 * prevent two read-modify-write operations from losing one another's update.
 */
export async function withDirectoryLock<T>(lockDir: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  await mkdir(dirname(lockDir), { recursive: true });
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let age: number;
      try { age = Date.now() - (await stat(lockDir)).mtimeMs; }
      catch (statErr) {
        if ((statErr as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statErr;
      }
      if (age > LOCK_STALE_MS) {
        const staleDir = `${lockDir}.stale-${process.pid}-${Date.now()}`;
        try {
          await rename(lockDir, staleDir);
          await rm(staleDir, { recursive: true, force: true });
        } catch (renameErr) {
          if ((renameErr as NodeJS.ErrnoException).code !== "ENOENT") throw renameErr;
        }
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error("Timed out waiting for another OreoDeck process to finish updating config.");
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  try {
    return await action();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}
