import { spawn } from "node:child_process";
import { addProfile, setApiKey, removeProfile, buildEnv } from "@ccm/core";
import { promptHidden } from "../prompt";

interface AddOptions {
  apiKey?: boolean;
}

export async function addCommand(name: string, opts: AddOptions): Promise<void> {
  if (opts.apiKey) {
    const key = await promptHidden("Anthropic API key: ");
    if (!key) throw new Error("No API key entered. Aborted.");
    await addProfile(name, "api-key");
    try {
      await setApiKey(name, key);
    } catch (err) {
      // Đừng để lại profile nửa vời nếu Keychain từ chối. removeProfile có
      // thể tự throw (vd. xóa thư mục thất bại) — không được để lỗi rollback
      // đó nuốt mất lỗi gốc từ setApiKey, vì đó mới là lý do người dùng cần
      // biết. setApiKey đã chủ động sanitize message của nó (không chứa
      // key), nên an toàn để in thẳng ra.
      try {
        await removeProfile(name);
      } catch {
        // Bỏ qua lỗi rollback: profile vẫn còn trong config, người dùng có
        // thể chạy `ccm remove` hoặc thử `ccm add` lại. Ưu tiên báo lỗi gốc.
      }
      throw err;
    }
    console.log(`Added API key profile "${name}".`);
    return;
  }

  await addProfile(name, "subscription");
  console.log(`Created profile "${name}".`);

  // CCM_SKIP_LOGIN cho phép test tạo profile mà không mở luồng OAuth.
  if (process.env.OREODECK_SKIP_LOGIN || process.env.CCM_SKIP_LOGIN) return;

  console.log("Opening Claude Code to sign in — run /login, then /exit when done.");
  // Route through buildEnv (not a hand-rolled env object) so this spawn gets
  // the same guarantees as launcher/failover: CLAUDE_CONFIG_DIR pinned to
  // this profile, and — critically for a subscription /login — any
  // ANTHROPIC_API_KEY inherited from the shell stripped, since a stray key
  // silently overrides OAuth and sabotages the login flow (F-4).
  const env = await buildEnv({ name, kind: "subscription" }, null, process.env);
  const bin = process.env.OREODECK_CLAUDE_BIN ?? process.env.CCM_CLAUDE_BIN ?? "claude"; // F-5: match launcher/failover.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, [], { stdio: "inherit", env });
    child.on("error", (err) =>
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`\`${bin}\` not found on PATH. Install Claude Code first.`)
          : err,
      ),
    );
    child.on("close", () => resolve());
  });
  console.log(`Profile "${name}" is ready. Run it with \`oreodeck run -P ${name}\`.`);
}
