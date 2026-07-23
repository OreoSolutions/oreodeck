import { expect, test } from "bun:test";
import { fitTerminalLine } from "./select";

test("picker rows are shortened before they can soft-wrap", () => {
  const result = fitTerminalLine("› [global] a very long session preview that would wrap", 24);
  expect(Array.from(result).length).toBeLessThanOrEqual(23);
  expect(result.endsWith("…")).toBe(true);
});

test("picker rows replace embedded newlines and preserve short labels", () => {
  expect(fitTerminalLine("short\nlabel", 80)).toBe("short label");
});
