// The text of each message of the Fabrium browser API that a project write can answer.
import { FabriumApiError } from "../client/fabrium-api";

export const SERVER_TEXT: Readonly<Record<string, string>> = {
  "unknown project": "That project no longer exists. Pick another one.",
  "a project agent needs a project vm": "A project agent runs only on a project VM.",
  "the vm has project agents": "This VM has project agents, so it must stay in a project.",
  "a project agent has no owner":
    "A project agent has no owner. Take it out of the project to give it one.",
  "a project vm has no owner":
    "A project VM has no owner. Take it out of the project to give it one.",
  "owner must be a person": "The owner must be a person, not an agent.",
  "project in use": "Something belongs to this project. Move it out first.",
  "invalid project name": "A project name has 1 to 64 characters, with no control characters.",
};

/** The text for the error of a request: a known message of the server, or the message as it is. */
export function serverText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return Object.hasOwn(SERVER_TEXT, message) ? SERVER_TEXT[message] : message;
}

/** As `serverText`, for a project write: there, `name in use` is the name of a project. */
export function projectNameText(e: unknown): string {
  // Keyed on the message: a delete answers 409 too, with `project in use`.
  return e instanceof FabriumApiError && e.message === "name in use"
    ? "A project with this name already exists."
    : serverText(e);
}
