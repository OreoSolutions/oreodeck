import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";

/** Keep picker rows on exactly one terminal line. Cursor-up redraw logic works
 * in logical rows, so allowing the terminal to soft-wrap a long session label
 * leaves stale rows behind and makes the list appear duplicated. */
export function fitTerminalLine(value: string, columns: number): string {
  const limit = Math.max(1, columns - 1);
  const characters = Array.from(value.replace(/[\r\n]+/g, " "));
  if (characters.length <= limit) return characters.join("");
  return `${characters.slice(0, limit - 1).join("")}…`;
}

export async function promptSelect(title: string, choices: readonly string[]): Promise<number> {
  if (!choices.length) throw new Error("There is nothing to select.");
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) throw new Error("Session selection requires an interactive Terminal.");
  let cursor = 0;
  let rendered = false;
  const visible = Math.min(choices.length, 12);
  const lines = visible + 2;
  const wasRaw = stdin.isRaw ?? false;
  const render = () => {
    if (rendered) stdout.write(`\x1b[${lines}A`);
    const start = Math.max(0, Math.min(cursor - Math.floor(visible / 2), choices.length - visible));
    const rows = [title, "↑/↓ move · Enter import and resume · Esc cancel"];
    for (let index = start; index < start + visible; index++) rows.push(`${index === cursor ? "›" : " "} ${choices[index]}`);
    const columns = stdout.columns && stdout.columns > 0 ? stdout.columns : 80;
    stdout.write(rows.map((row) => `\x1b[2K\r${fitTerminalLine(row, columns)}`).join("\n") + "\n");
    rendered = true;
  };
  return new Promise<number>((resolve, reject) => {
    const cleanup = () => { stdin.removeListener("keypress", onKey); stdin.setRawMode?.(wasRaw); stdin.pause(); };
    const onKey = (_value: string, key: { name?: string; ctrl?: boolean }) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") { cleanup(); reject(new Error("Aborted.")); return; }
      if (key.name === "up") cursor = (cursor - 1 + choices.length) % choices.length;
      else if (key.name === "down") cursor = (cursor + 1) % choices.length;
      else if (key.name === "return" || key.name === "enter") { cleanup(); resolve(cursor); return; }
      else return;
      render();
    };
    emitKeypressEvents(stdin); stdin.setRawMode(true); stdin.resume(); stdin.on("keypress", onKey); render();
  });
}
