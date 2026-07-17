import type { ProfileUsageView } from "../lib/api";

const CLASSES: { key: keyof ProfileUsageView; label: string; color: string }[] = [
  { key: "inputTokens", label: "input", color: "#4f46e5" },
  { key: "cacheWrite5mTokens", label: "cache write 5m", color: "#0891b2" },
  { key: "cacheWrite1hTokens", label: "cache write 1h", color: "#0e7490" },
  { key: "cacheReadTokens", label: "cache read", color: "#65a30d" },
  { key: "outputTokens", label: "output", color: "#ea580c" },
];

export default function UsageBar({ usage }: { usage: ProfileUsageView }) {
  const total = usage.totalTokens || 1;
  return (
    <div className="bar" role="img" aria-label={`usage for ${usage.profile}`}>
      {CLASSES.map((c) => {
        const value = usage[c.key] as number;
        if (value <= 0) return null;
        return (
          <div
            key={c.label}
            data-class={c.label}
            title={`${c.label}: ${value.toLocaleString()}`}
            style={{ width: `${(value / total) * 100}%`, background: c.color }}
          />
        );
      })}
    </div>
  );
}
