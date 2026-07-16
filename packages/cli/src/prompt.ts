import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Đọc một dòng từ stdin. Nếu stdin là TTY thì tắt echo để không hiện API key
 * ra màn hình (thay bằng "*"); nếu là pipe (test, script) thì đọc thẳng.
 *
 * LƯU Ý (deviation từ brief): brief đề xuất dùng readline với
 * `(rl as unknown as { line: string }).line` để đọc lại nội dung đã gõ rồi
 * ghi đè dòng bằng "*". Đã verify thủ công bằng `expect` (gửi từng ký tự
 * một, giống người gõ thật): readline tự echo ký tự ra màn hình trước khi
 * listener của ta kịp ghi đè, nên MỖI ký tự đều lộ ra plaintext trong
 * khoảnh khắc giữa hai lần gõ, và ký tự cuối cùng trước Enter không bao giờ
 * được che. Vi phạm trực tiếp yêu cầu "API key must never appear in
 * plaintext on screen". Thay vào đó, cách dưới đây tự bật raw mode và tự vẽ
 * "*", nên ký tự gốc không bao giờ được TTY echo ra.
 */
export async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout, terminal: false });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw ?? false;
    // Bật raw mode TRƯỚC KHI in prompt: nếu in trước rồi mới bật raw mode,
    // có một khoảng hở (dù ngắn) mà TTY còn ở chế độ echo mặc định và có
    // thể lộ ký tự gõ sớm.
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write(question);

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (char === "\x03") {
          // Ctrl-C: khôi phục terminal rồi thoát như shell mặc định.
          cleanup();
          stdout.write("\n");
          reject(new Error("Aborted."));
          return;
        }
        if (char === "\x7f" || char === "\x08") {
          // Backspace/Delete.
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\x08 \x08");
          }
          continue;
        }
        value += char;
        stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

export async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
