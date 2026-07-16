import { mkdir, rename, writeFile, readFile, unlink } from "node:fs/promises";
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
