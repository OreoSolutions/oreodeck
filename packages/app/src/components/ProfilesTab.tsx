import { useEffect, useState } from "react";
import {
  listProfiles,
  setActive,
  openSession,
  openLoginTerminal,
  removeProfile,
  type ProfileView,
} from "../lib/api";
import RemoveDialog from "./RemoveDialog";
import AddApiKeyForm from "./AddApiKeyForm";

export default function ProfilesTab() {
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    listProfiles()
      .then(setProfiles)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    reload();
  }, []);

  const guard = (p: Promise<unknown>) => p.catch((e) => setError(String(e))).finally(reload);

  const addSubscription = () => {
    const name = window.prompt("New subscription profile name:");
    if (!name) return;
    // Open Terminal for `ccm add`, then poll config until the profile appears.
    openLoginTerminal(name)
      .then(() => pollForProfile(name))
      .catch((e) => setError(String(e)));
  };

  const pollForProfile = (name: string, tries = 0) => {
    listProfiles()
      .then((ps) => {
        setProfiles(ps);
        const found = ps.some((p) => p.name.toLowerCase() === name.toLowerCase());
        if (!found && tries < 30) setTimeout(() => pollForProfile(name, tries + 1), 2000);
      })
      .catch(() => {});
  };

  return (
    <section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Profile</th>
            <th>Kind</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>{p.kind}</td>
              <td>{p.active ? "●" : ""}</td>
              <td>
                <button disabled={p.active} onClick={() => guard(setActive(p.name))}>
                  Set active
                </button>
                <button onClick={() => openSession(p.name).catch((e) => setError(String(e)))}>
                  Open session
                </button>
                {!removing && <button onClick={() => setRemoving(p.name)}>Remove</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="add-actions">
        <button onClick={addSubscription}>Add subscription profile</button>
      </div>
      <AddApiKeyForm onAdded={reload} />

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
