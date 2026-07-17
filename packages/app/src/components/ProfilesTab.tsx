import { useEffect, useState } from "react";
import {
  listProfiles,
  getUsage,
  setActive,
  openSession,
  removeProfile,
  toUserMessage,
  type ProfileView,
  type ProfileUsageView,
} from "../lib/api";
import { formatCost, formatCountdown } from "../lib/format";
import RemoveDialog from "./RemoveDialog";
import AddApiKeyForm from "./AddApiKeyForm";
import AddSubscriptionForm from "./AddSubscriptionForm";

export default function ProfilesTab() {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [usage, setUsage] = useState<ProfileUsageView[]>([]);
  const [now, setNow] = useState(Date.now());
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setNow(Date.now());
    return Promise.all([listProfiles(), getUsage()])
      .then(([ps, us]) => {
        setProfiles(ps);
        setUsage(us);
      })
      .catch((e) => setError(toUserMessage(e)));
  };

  useEffect(() => {
    reload();
    const id = setInterval(reload, 30_000); // refresh every 30s, same cadence as Usage/tray
    return () => clearInterval(id);
  }, []);

  const guard = (p: Promise<unknown>) => p.catch((e) => setError(toUserMessage(e))).finally(reload);

  const usageFor = (name: string) => usage.find((u) => u.profile === name);

  return (
    <section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {profiles.length === 0 ? (
        <p className="empty">
          No profiles yet. Create one with <code>ccm add &lt;name&gt;</code>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Kind</th>
              <th>Active</th>
              <th>Token (5h)</th>
              <th>Cost</th>
              <th>Reset</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const u = usageFor(p.name);
              return (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.kind}</td>
                  <td>{p.active ? "●" : ""}</td>
                  <td>{u ? u.totalTokens.toLocaleString() : "—"}</td>
                  <td>{u ? formatCost(u) : "—"}</td>
                  <td>{u ? formatCountdown(u.resetAt, now) : "—"}</td>
                  <td>
                    <button disabled={p.active} onClick={() => guard(setActive(p.name))}>
                      Set active
                    </button>
                    <button
                      onClick={() => openSession(p.name).catch((e) => setError(toUserMessage(e)))}
                    >
                      Open session
                    </button>
                    {!removing && <button onClick={() => setRemoving(p.name)}>Remove</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="add-actions">
        <AddSubscriptionForm onAdded={reload} />
        <AddApiKeyForm onAdded={reload} />
      </div>

      {removing && (
        <RemoveDialog
          name={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const name = removing;
            setRemoving(null);
            guard(removeProfile(name));
          }}
        />
      )}
    </section>
  );
}
