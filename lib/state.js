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

export function isSettledStep(step) {
  return step.status === 'completed' || step.status === 'skipped';
}

export function nextPendingStep(state) {
  // 按依赖顺序取第一个未结束步骤，不能被后面的 waiting/显式 step 越过。
  return state.steps.find((s) => !isSettledStep(s)) ?? null;
}

export function progressOf(state) {
  const done = state.steps.filter(isSettledStep).length;
  return { done, total: state.steps.length };
}
