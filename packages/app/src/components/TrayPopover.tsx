import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getUsage, setActive, openSession, type ProfileUsageView } from "../lib/api";
import UsageBar from "./UsageBar";

export default function TrayPopover() {
  const [rows, setRows] = useState<ProfileUsageView[]>([]);

  useEffect(() => {
    const load = () => getUsage().then(setRows).catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="tray">
      {rows.map((r) => (
        <div key={r.profile} className="tray-row">
          <button className="tray-name" onClick={() => setActive(r.profile).catch(() => {})}>
            {r.active ? "● " : ""}
            {r.profile}
          </button>
          <UsageBar usage={r} />
          <button aria-label={`open ${r.profile}`} onClick={() => openSession(r.profile).catch(() => {})}>
            ▶
          </button>
        </div>
      ))}
      <footer className="tray-footer">
        <button onClick={() => invoke("show_dashboard")}>Open dashboard</button>
        <button onClick={() => invoke("quit_app")}>Quit</button>
      </footer>
    </div>
  );
}
