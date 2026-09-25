// Picsur can restart itself from the settings page, to apply server settings.
// The application is closed and started again within the same process, so
// this does not depend on something like docker to start it again.

import { Fail, Failable, FT } from 'picsur-shared/dist/types/failable';

// Whether something restarts Picsur when asked, which the command line tool
// does not
let restartable = false;
let requestRestart: (() => void) | null = null;
let startedAt = new Date();
let restartError: string | null = null;

// Resolves when a restart is asked for
export function WaitForRestart(): Promise<void> {
  restartable = true;
  return new Promise((resolve) => {
    requestRestart = resolve;
  });
}

export function RequestRestart(): Failable<true> {
  if (!restartable) {
    return Fail(FT.Impossible, 'Picsur can not restart itself here');
  }
  if (requestRestart === null) {
    return Fail(FT.Conflict, 'Picsur is already restarting');
  }
  const restart = requestRestart;
  requestRestart = null;
  // Give the response to whoever asked for it time to go out first
  setTimeout(restart, 250);
  return true;
}

export function MarkStarted() {
  startedAt = new Date();
}

export function StartedAt(): Date {
  return startedAt;
}

// Set when a restart failed with new settings, and the previous ones were
// used again
export function SetRestartError(error: string | null) {
  restartError = error;
}

export function RestartError(): string | null {
  return restartError;
}
