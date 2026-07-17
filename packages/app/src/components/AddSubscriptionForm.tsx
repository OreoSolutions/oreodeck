import { useState } from "react";
import { openLoginTerminal, listProfiles, toUserMessage } from "../lib/api";

export default function AddSubscriptionForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Poll list_profiles until the name typed above shows up (the account logs in via a
  // separate Terminal window, so there is no synchronous "added" signal).
  const pollForProfile = (target: string, tries = 0) => {
    listProfiles()
      .then((ps) => {
        if (ps.some((p) => p.name.toLowerCase() === target.toLowerCase())) {
          onAdded();
          return;
        }
        if (tries < 30) setTimeout(() => pollForProfile(target, tries + 1), 2000);
      })
      .catch(() => {});
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const target = name.trim();
    if (!target) return;
    try {
      await openLoginTerminal(target);
      setName("");
      pollForProfile(target);
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  return (
    <form onSubmit={submit} aria-label="Add subscription profile">
      <input
        aria-label="subscription profile name"
        placeholder="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit">Add subscription profile</button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
