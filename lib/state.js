import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STATE_VERSION = 1;
export const STATE_DIR = '.mmw';

export function statePath(workspace) {
  return path.join(workspace, STATE_DIR, 'state.json');
}

export async function readState(workspace) {
  try {
    const raw = await readFile(statePath(workspace), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeState(workspace, state) {
  await mkdir(path.join(workspace, STATE_DIR), { recursive: true });
  await writeFile(statePath(workspace), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

export function nextPendingStep(state) {
  return (
    state.steps.find((s) => s.status === 'waiting') ??
    state.steps.find((s) => s.status === 'pending' || s.status === 'running' || s.status === 'blocked') ??
    null
  );
}

export function progressOf(state) {
  const done = state.steps.filter((s) => s.status === 'completed').length;
  return { done, total: state.steps.length };
}
