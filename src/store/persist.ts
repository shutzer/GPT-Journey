import { del, get, set } from "idb-keyval";
import { DEFAULT_SETTINGS, type Settings } from "../ai/types";
import { summarize, type CaseRecord, type CaseSummary } from "../game/state";

const SETTINGS = "caseFiles.settings";
const KEYS = "caseFiles.keys";
const INDEX = "cases:index";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Settings live in localStorage; API keys only when the player opts in, otherwise per tab. */
export function loadSettings(): Settings {
  const stored = safe(() => JSON.parse(localStorage.getItem(SETTINGS) ?? "null"), null) as Partial<Settings> | null;
  const keys = safe(
    () => JSON.parse(localStorage.getItem(KEYS) ?? sessionStorage.getItem(KEYS) ?? "null"),
    null,
  ) as Settings["keys"] | null;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    models: { ...DEFAULT_SETTINGS.models, ...stored?.models },
    keys: { ...DEFAULT_SETTINGS.keys, ...keys },
  };
}

export function saveSettings(s: Settings): void {
  const { keys, ...rest } = s;
  safe(() => {
    localStorage.setItem(SETTINGS, JSON.stringify(rest));
    localStorage.removeItem(KEYS);
    sessionStorage.removeItem(KEYS);
    (s.rememberKeys ? localStorage : sessionStorage).setItem(KEYS, JSON.stringify(keys));
  }, undefined);
}

export async function listCases(): Promise<CaseSummary[]> {
  const index = ((await get(INDEX)) as CaseSummary[] | undefined) ?? [];
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadCase(id: string): Promise<CaseRecord | undefined> {
  return get(`case:${id}`);
}

export async function saveCase(record: CaseRecord): Promise<void> {
  await set(`case:${record.id}`, record);
  const index = ((await get(INDEX)) as CaseSummary[] | undefined) ?? [];
  await set(INDEX, [summarize(record), ...index.filter((c) => c.id !== record.id)]);
}

export async function deleteCase(id: string): Promise<void> {
  await del(`case:${id}`);
  const index = ((await get(INDEX)) as CaseSummary[] | undefined) ?? [];
  await set(INDEX, index.filter((c) => c.id !== id));
}
