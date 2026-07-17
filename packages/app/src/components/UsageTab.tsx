import { useEffect, useState } from "react";
import { getUsage, openConfigInEditor, toUserMessage, type ProfileUsageView } from "../lib/api";
import { formatCost, formatCountdown } from "../lib/format";
import UsageBar from "./UsageBar";

export default function UsageTab() {
  const [rows, setRows] = useState<ProfileUsageView[]>([]);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      getUsage()
        .then((r) => {
          setError(null);
          setRows(r);
        })
        .catch((e) => setError(toUserMessage(e)));
      setNow(Date.now());
    };
    load();
    const id = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <section>
        <p role="alert" className="error">
          {error}
        </p>
        <button onClick={() => openConfigInEditor()}>Open config file</button>
      </section>
    );
  }

  return (
    <section>
      {rows.length === 0 ? (
        <p className="empty">
          No profiles yet. Create one with <code>ccm add &lt;name&gt;</code>.
        </p>
      ) : (
        rows.map((r) => (
          <div key={r.profile} className="usage-row">
            <div className="usage-head">
              <strong>{r.profile}</strong>
              <span>{r.totalTokens.toLocaleString()} tokens</span>
              <span>{formatCost(r)}</span>
              <span>resets in {formatCountdown(r.resetAt, now)}</span>
            </div>
            <UsageBar usage={r} />
          </div>
        ))
      )}
    </section>
  );
}
