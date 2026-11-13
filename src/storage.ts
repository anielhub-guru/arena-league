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

/** The save the game is currently playing. Every read and write below goes to this slot. */
let slot = "";
export const currentSlot = () => slot;
export const setSlot = (id: string) => {
  slot = id;
  try {
    localStorage.setItem("dominion:last-slot", id);
  } catch {
    /* storage unavailable: the last played save is not remembered */
  }
};
export const lastSlot = () => {
  try {
    return localStorage.getItem("dominion:last-slot") ?? "";
  } catch {
    return "";
  }
};
export const newSlotId = () => `game-${Date.now().toString(36)}`;

/** Browser fallback: move the old single save into the first slot once. */
function migrateSingleBrowserSave(): void {
  if (typeof localStorage === "undefined") return;
  const old = localStorage.getItem("dominion:save");
  if (old === null) return;
  localStorage.setItem("dominion:save:game-1", old);
  localStorage.removeItem("dominion:save");
  for (const k of Object.keys(localStorage)) {
    const m = /^dominion:match:(.+)$/.exec(k);
    if (m && !m[1].includes(":")) {
      localStorage.setItem(`dominion:match:game-1:${m[1]}`, localStorage.getItem(k) as string);
      localStorage.removeItem(k);
    }
  }
}
migrateSingleBrowserSave();

export async function listSaves(): Promise<string[]> {
  if (inTauri()) return call<string[]>("list_saves");
  return Object.keys(localStorage).filter((k) => k.startsWith("dominion:save:")).map((k) => k.slice("dominion:save:".length)).sort();
}

export async function loadSave(id: string): Promise<string | null> {
  return inTauri() ? call<string | null>("load_save", { slot: id }) : localStorage.getItem(`dominion:save:${id}`);
}

export async function writeSave(state: SeasonState): Promise<void> {
  const json = JSON.stringify(state);
  if (inTauri()) await call("write_save", { slot, json });
  else localStorage.setItem(`dominion:save:${slot}`, json);
}

export async function writeMatchLogs(logs: MatchLog[]): Promise<void> {
  for (const log of logs) {
    const json = JSON.stringify(log);
    if (inTauri()) await call("write_match_log", { slot, id: log.id, json });
    else localStorage.setItem(`dominion:match:${slot}:${log.id}`, json);
  }
}

export async function readMatchLog(id: string): Promise<MatchLog | null> {
  const raw = inTauri() ? await call<string | null>("read_match_log", { slot, id }) : localStorage.getItem(`dominion:match:${slot}:${id}`);
  return raw ? (JSON.parse(raw) as MatchLog) : null;
}

/** Deletes one saved game and its match logs. */
export async function deleteSave(id: string): Promise<void> {
  if (inTauri()) await call("delete_save", { slot: id });
  else Object.keys(localStorage).filter((k) => k === `dominion:save:${id}` || k.startsWith(`dominion:match:${id}:`)).forEach((k) => localStorage.removeItem(k));
}

export async function dataDir(): Promise<string> {
  return inTauri() ? call<string>("data_dir") : "(browser localStorage)";
}
