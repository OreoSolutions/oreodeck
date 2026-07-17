import { useEffect, useState } from "react";
import { getUsage, type ProfileUsageView } from "../lib/api";
import UsageBar from "./UsageBar";

function countdown(resetAt: number | null, now: number): string {
  if (resetAt === null) return "—";
  const ms = resetAt - now;
  if (ms <= 0) return "resetting";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export default function UsageTab() {
  const [rows, setRows] = useState<ProfileUsageView[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = () => {
      getUsage().then(setRows).catch(() => {});
      setNow(Date.now());
    };
    load();
    const id = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(id);
  }, []);

  return (
    <section>
      {rows.map((r) => (
        <div key={r.profile} className="usage-row">
          <div className="usage-head">
            <strong>{r.profile}</strong>
            <span>{r.totalTokens.toLocaleString()} tokens</span>
            <span>{r.kind === "api-key" ? `$${r.costUsd.toFixed(2)}` : "—"}</span>
            <span>resets in {countdown(r.resetAt, now)}</span>
          </div>
          <UsageBar usage={r} />
        </div>
      ))}
    </section>
  );
}
