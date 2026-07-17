import { useEffect, useState } from "react";
import { checkCli, listProfiles, CONFIG_CORRUPT, openConfigInEditor } from "./lib/api";
import ProfilesTab from "./components/ProfilesTab";
import UsageTab from "./components/UsageTab";
import FailoverTab from "./components/FailoverTab";

type Tab = "profiles" | "usage" | "failover";

export default function App() {
  const [tab, setTab] = useState<Tab>("profiles");
  const [cliInstalled, setCliInstalled] = useState(true);
  const [corrupt, setCorrupt] = useState(false);

  useEffect(() => {
    checkCli()
      .then((s) => setCliInstalled(s.installed))
      .catch(() => setCliInstalled(false));
    listProfiles().catch((e) => {
      if (String(e) === CONFIG_CORRUPT) setCorrupt(true);
    });
  }, []);

  if (corrupt) {
    return (
      <div className="banner error" role="alert">
        <p>Your ~/.ccm/config.json is corrupt and could not be read. ccm changed nothing.</p>
        <button onClick={() => openConfigInEditor()}>Open config file</button>
        <button
          onClick={() => {
            setCorrupt(false);
            location.reload();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      {!cliInstalled && (
        <div className="banner warn" role="status">
          The <code>ccm</code> CLI is not on your PATH. Install it to open sessions and add
          subscription logins.
        </div>
      )}
      <nav className="tabs">
        <button aria-pressed={tab === "profiles"} onClick={() => setTab("profiles")}>
          Profiles
        </button>
        <button aria-pressed={tab === "usage"} onClick={() => setTab("usage")}>
          Usage
        </button>
        <button aria-pressed={tab === "failover"} onClick={() => setTab("failover")}>
          Failover
        </button>
      </nav>
      {tab === "profiles" && <ProfilesTab />}
      {tab === "usage" && <UsageTab />}
      {tab === "failover" && <FailoverTab />}
    </div>
  );
}
