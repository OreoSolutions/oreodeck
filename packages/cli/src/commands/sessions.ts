import { importSessionToProfile, listImportableSessions, resolveProfileName } from "@ccm/core";
import { promptSelect } from "../select";
import { claudeCommand } from "./claude";

export async function sessionsCommand(opts: { profile?: string; list?: boolean; from?: string }): Promise<void> {
  const destination = await resolveProfileName(opts.profile);
  let sessions = await listImportableSessions(destination);
  if (opts.from) sessions = sessions.filter((session) => session.source.toLowerCase() === opts.from!.toLowerCase());
  if (!sessions.length) throw new Error(`No sessions found outside profile "${destination}".`);
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
