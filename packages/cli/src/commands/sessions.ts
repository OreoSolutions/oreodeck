import { resolve } from "node:path";
import { importSessionToProfile, listImportableSessions, resolveProfileName, type SharedSession } from "@ccm/core";
import { promptSelect } from "../select";
import { claudeCommand } from "./claude";

export function sessionsForDirectory(sessions: SharedSession[], cwd: string): SharedSession[] {
  const current = resolve(cwd);
  return sessions.filter((session) => session.project !== "Unknown project" && resolve(session.project) === current);
}

export async function sessionsCommand(opts: { profile?: string; list?: boolean; from?: string; all?: boolean }): Promise<void> {
  const destination = await resolveProfileName(opts.profile);
  let sessions = await listImportableSessions(destination);
  if (opts.from) sessions = sessions.filter((session) => session.source.toLowerCase() === opts.from!.toLowerCase());
  if (!opts.all) sessions = sessionsForDirectory(sessions, process.cwd());
  if (!sessions.length) {
    throw new Error(opts.all
      ? `No sessions found outside profile "${destination}".`
      : `No sessions found for the current folder. Use \`ord sessions --all\` to browse every project.`);
  }
  const labels = sessions.map((session) => {
    const date = new Date(session.mtime).toLocaleString();
    const project = session.project.split("/").filter(Boolean).at(-1) ?? session.project;
    return `[${session.source}] ${date} · ${project} · ${session.preview}`;
  });
  if (opts.list) {
    sessions.forEach((session, index) => console.log(`${session.id}\t${labels[index]}`));
    return;
  }
  const selected = sessions[await promptSelect(`Import a session into "${destination}"`, labels)]!;
  await importSessionToProfile(selected, destination);
  console.log(`Imported ${selected.id} from "${selected.source}" into "${destination}".`);
  await claudeCommand(["--resume", selected.id], { profile: destination });
}
