import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";

interface Keypress {
  name?: string;
  ctrl?: boolean;
}

interface CheckboxOptions {
  disabled?: ReadonlySet<string>;
  annotations?: ReadonlyMap<string, string>;
}

export async function promptCheckboxes(
  title: string,
  choices: readonly string[],
  initiallySelected: readonly string[] = [],
  options: CheckboxOptions = {},
): Promise<string[]> {
  if (choices.length === 0) return [];
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
    throw new Error("Interactive selection requires a Terminal. For automation, pass resources after the profile name.");
  }

  const selected = new Set(initiallySelected.filter((choice) => !options.disabled?.has(choice)));
  let cursor = 0;
  let rendered = false;
  const lineCount = choices.length + 2;
  const wasRaw = stdin.isRaw ?? false;

  const render = () => {
    if (rendered) stdout.write(`\x1b[${lineCount}A`);
    const lines = [
      title,
      "↑/↓ move · Space select · Enter confirm",
      ...choices.map((choice, index) => {
        const disabled = options.disabled?.has(choice) ?? false;
        const mark = disabled ? "[!]" : selected.has(choice) ? "[x]" : "[ ]";
        const note = options.annotations?.get(choice);
        return `${index === cursor ? "›" : " "} ${mark} ${choice}${note ? ` — ${note}` : ""}`;
      }),
    ];
    stdout.write(lines.map((line) => `\x1b[2K\r${line}`).join("\n") + "\n");
    rendered = true;
  };

  return new Promise<string[]>((resolve, reject) => {
    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
    };
    const onKeypress = (value: string, key: Keypress) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        stdout.write("\n");
        reject(new Error("Aborted."));
        return;
      }
      if (key.name === "up") cursor = (cursor - 1 + choices.length) % choices.length;
      else if (key.name === "down") cursor = (cursor + 1) % choices.length;
      else if (key.name === "space" || value === " ") {
        const choice = choices[cursor]!;
        if (options.disabled?.has(choice)) {
          render();
          return;
        }
        if (selected.has(choice)) selected.delete(choice);
        else selected.add(choice);
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(choices.filter((choice) => selected.has(choice)));
        return;
      } else return;
      render();
    };

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
    render();
  });
}
