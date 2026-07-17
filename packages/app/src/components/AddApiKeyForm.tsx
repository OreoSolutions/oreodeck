import { useState } from "react";
import { addApiKeyProfile } from "../lib/api";

export default function AddApiKeyForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await addApiKeyProfile(name, key);
      // Drop the key from component state the moment it is persisted.
      setName("");
      setKey("");
      onAdded();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <form onSubmit={submit} aria-label="Add API key profile">
      <input
        aria-label="profile name"
        placeholder="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="api key"
        type="password"
        placeholder="sk-ant-..."
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button type="submit">Add API key profile</button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
