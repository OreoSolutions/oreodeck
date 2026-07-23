import { expect, test } from "bun:test";
import type { SharedSession } from "@ccm/core";
import { sessionsForDirectory } from "./commands/sessions";

function session(id: string, project: string): SharedSession {
  return { id, project, path: `/tmp/${id}.jsonl`, source: "global", preview: id, mtime: 1 };
}

test("sessions default filtering keeps only the current project folder", () => {
  const sessions = [
    session("current", "/workspace/current"),
    session("other", "/workspace/other"),
    session("unknown", "Unknown project"),
  ];
  expect(sessionsForDirectory(sessions, "/workspace/current").map((item) => item.id)).toEqual(["current"]);
});

test("sessions folder comparison normalizes dot segments and trailing separators", () => {
  const sessions = [session("same", "/workspace/project/packages/..")];
  expect(sessionsForDirectory(sessions, "/workspace/project/").map((item) => item.id)).toEqual(["same"]);
});
