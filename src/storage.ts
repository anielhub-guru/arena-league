import type { MatchLog } from "./engine/types";
import type { SeasonState } from "./league/season";

/**
 * Persistence. In the packaged app every call goes to Rust commands that write
 * into the app's local data directory. In a plain browser (npm run dev without
 * Tauri) we fall back to localStorage so the UI can still be developed.
 */
/** One-time move of browser-fallback data from the old "arena:" keys. */
function migrateLegacyKeys(): void {
  if (typeof localStorage === "undefined") return;
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith("arena:")) continue;
    const next = "dominion:" + k.slice("arena:".length);
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(k) as string);
    localStorage.removeItem(k);
  }
}
migrateLegacyKeys();

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function loadSave(): Promise<string | null> {
  return inTauri() ? call<string | null>("load_save") : localStorage.getItem("dominion:save");
}

export async function writeSave(state: SeasonState): Promise<void> {
  const json = JSON.stringify(state);
  if (inTauri()) await call("write_save", { json });
  else localStorage.setItem("dominion:save", json);
}

export async function writeMatchLogs(logs: MatchLog[]): Promise<void> {
  for (const log of logs) {
    const json = JSON.stringify(log);
    if (inTauri()) await call("write_match_log", { id: log.id, json });
    else localStorage.setItem(`dominion:match:${log.id}`, json);
  }
}

export async function readMatchLog(id: string): Promise<MatchLog | null> {
  const raw = inTauri() ? await call<string | null>("read_match_log", { id }) : localStorage.getItem(`dominion:match:${id}`);
  return raw ? (JSON.parse(raw) as MatchLog) : null;
}

export async function resetSave(): Promise<void> {
  if (inTauri()) await call("reset_save");
  else Object.keys(localStorage).filter((k) => k.startsWith("dominion:")).forEach((k) => localStorage.removeItem(k));
}

export async function dataDir(): Promise<string> {
  return inTauri() ? call<string>("data_dir") : "(browser localStorage)";
}
