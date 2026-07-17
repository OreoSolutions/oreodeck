import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getUsage, setActive, openSession, CONFIG_CORRUPT, type ProfileUsageView } from "../lib/api";
import UsageBar from "./UsageBar";

export default function TrayPopover() {
  const [rows, setRows] = useState<ProfileUsageView[]>([]);
  const [corrupt, setCorrupt] = useState(false);

  useEffect(() => {
    // The tray window's webview loads at startup (visible:false in tauri.conf.json)
    // but stays mounted for the app's lifetime — poll only while actually on-screen.
    // lib.rs emits "popover-visible" from the show/hide handlers that own that state.
    let id: ReturnType<typeof setInterval> | undefined;

    const load = () =>
      getUsage()
        .then((r) => {
          setCorrupt(false);
          setRows(r);
        })
        .catch((e) => {
          if (String(e) === CONFIG_CORRUPT) setCorrupt(true);
        });

    const startPolling = () => {
      if (id !== undefined) return; // already polling — don't stack a second interval
      load();
      id = setInterval(load, 30_000);
    };

    const stopPolling = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };

    const unlistenPromise = listen<boolean>("popover-visible", (event) => {
      if (event.payload) startPolling();
      else stopPolling();
    });

    return () => {
      stopPolling();
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (corrupt) {
    return (
      <div className="banner error" role="alert">
        <p>Config corrupt — open the dashboard to fix it.</p>
        <button onClick={() => invoke("open_config_in_editor")}>Open config file</button>
      </div>
    );
  }

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
