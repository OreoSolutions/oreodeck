import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import TrayPopover from "./components/TrayPopover";
import "./styles.css";

// The "tray" window loads the same bundle; render the compact popover there.
function isTrayWindow(): boolean {
  try {
    return getCurrentWindow().label === "tray";
  } catch {
    return false; // not inside Tauri (e.g. plain browser) — show the dashboard
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isTrayWindow() ? <TrayPopover /> : <App />}</React.StrictMode>,
);
