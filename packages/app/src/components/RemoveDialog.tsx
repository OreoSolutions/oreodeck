import { useState } from "react";

export default function RemoveDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  return (
    <div role="dialog" aria-label="Confirm remove" className="dialog">
      <p>
        This permanently deletes the login, session history, and any stored API key for{" "}
        <strong>{name}</strong>. This cannot be undone.
      </p>
      <p>
        Type <strong>{name}</strong> to confirm:
      </p>
      <input aria-label="confirm name" value={typed} onChange={(e) => setTyped(e.target.value)} />
      <div>
        <button onClick={onCancel}>Cancel</button>
        <button disabled={typed !== name} onClick={onConfirm}>
          Remove
        </button>
      </div>
    </div>
  );
}
