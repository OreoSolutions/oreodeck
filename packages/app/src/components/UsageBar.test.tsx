import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import UsageBar from "./UsageBar";
import type { ProfileUsageView } from "../lib/api";

const usage: ProfileUsageView = {
  profile: "work",
  kind: "api-key",
  inputTokens: 3700,
  cacheWrite5mTokens: 10000,
  cacheWrite1hTokens: 4000,
  cacheReadTokens: 5000,
  outputTokens: 2000,
  totalTokens: 24700,
  costUsd: 0.09195,
  resetAt: 1784214005000,
  active: true,
};

describe("UsageBar", () => {
  it("renders one segment per non-zero token class", () => {
    const { container } = render(<UsageBar usage={usage} />);
    const segments = container.querySelectorAll(".bar > div");
    expect(segments.length).toBe(5); // all five classes are non-zero here
  });

  it("omits zero-width classes", () => {
    const { container } = render(
      <UsageBar usage={{ ...usage, cacheWrite1hTokens: 0, cacheReadTokens: 0 }} />,
    );
    expect(container.querySelectorAll(".bar > div").length).toBe(3);
  });

  it("stacks segments in the spec order: input, cache5m, cache1h, cacheRead, output", () => {
    const { container } = render(<UsageBar usage={usage} />);
    const segments = container.querySelectorAll(".bar > div");
    const classes = Array.from(segments).map((el) => el.getAttribute("data-class"));
    expect(classes).toEqual([
      "input",
      "cache write 5m",
      "cache write 1h",
      "cache read",
      "output",
    ]);
  });
});
