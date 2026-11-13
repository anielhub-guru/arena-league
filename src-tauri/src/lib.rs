use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SAVE_FILE: &str = "season.json";
const MATCH_DIR: &str = "matches";
const SAVES_DIR: &str = "saves";

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

/// Match ids become file names, so only allow a conservative character set.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Write to a temp file then rename, so a crash never leaves a half-written save.
fn atomic_write(path: &Path, data: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Keep the previous save as season.bak.json so one bad write or bug never costs a whole career.
/// Best effort: a failed backup must not block saving.
fn backup_previous(path: &Path) {
    if path.exists() {
        let _ = fs::copy(path, path.with_extension("bak.json"));
    }
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// One folder per saved game: saves/<slot>/season.json and saves/<slot>/matches/.
fn slot_dir(app: &AppHandle, slot: &str) -> Result<PathBuf, String> {
    if !valid_id(slot) {
        return Err("invalid save slot".into());
    }
    Ok(root(app)?.join(SAVES_DIR).join(slot))
}

#[tauri::command]
fn list_saves(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = root(&app)?.join(SAVES_DIR);
    let mut slots = Vec::new();
    match fs::read_dir(&dir) {
        Ok(entries) => {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if valid_id(&name) && e.path().join(SAVE_FILE).exists() {
                    slots.push(name);
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    slots.sort();
    Ok(slots)
}

#[tauri::command]
fn load_save(app: AppHandle, slot: String) -> Result<Option<String>, String> {
    read_optional(&slot_dir(&app, &slot)?.join(SAVE_FILE))
}

#[tauri::command]
fn write_save(app: AppHandle, slot: String, json: String) -> Result<(), String> {
    let path = slot_dir(&app, &slot)?.join(SAVE_FILE);
    backup_previous(&path);
    atomic_write(&path, &json)
}

#[tauri::command]
fn write_match_log(app: AppHandle, slot: String, id: String, json: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid match id".into());
    }
    atomic_write(&slot_dir(&app, &slot)?.join(MATCH_DIR).join(format!("{id}.json")), &json)
}

#[tauri::command]
fn read_match_log(app: AppHandle, slot: String, id: String) -> Result<Option<String>, String> {
    if !valid_id(&id) {
        return Err("invalid match id".into());
    }
    read_optional(&slot_dir(&app, &slot)?.join(MATCH_DIR).join(format!("{id}.json")))
}

/// Deletes one saved game (its season, backup and match logs). Other saves are untouched.
#[tauri::command]
fn delete_save(app: AppHandle, slot: String) -> Result<(), String> {
    match fs::remove_dir_all(slot_dir(&app, &slot)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Moves the old single save (season.json + matches/) into the first save slot. Best effort, runs once.
fn migrate_single_save(root: &Path) {
    if !root.join(SAVE_FILE).exists() {
        return;
    }
    let slot = root.join(SAVES_DIR).join("game-1");
    if slot.exists() || fs::create_dir_all(&slot).is_err() {
        return;
    }
    let _ = fs::rename(root.join(SAVE_FILE), slot.join(SAVE_FILE));
    let _ = fs::rename(root.join("season.bak.json"), slot.join("season.bak.json"));
    let _ = fs::rename(root.join(MATCH_DIR), slot.join(MATCH_DIR));
}

#[tauri::command]
fn data_dir(app: AppHandle) -> Result<String, String> {
    Ok(root(&app)?.display().to_string())
}

const LEGACY_IDENTIFIER: &str = "com.arenaleague.manager";

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// One-time migration from the pre-rename data folder (com.arenaleague.manager).
/// Copies (never moves) so the old data stays as a backup. Best effort: never blocks startup.
fn migrate_legacy_data(current: &Path) {
    if current.join(SAVE_FILE).exists() || current.join(SAVES_DIR).exists() {
        return;
    }
    if let Some(parent) = current.parent() {
        let legacy = parent.join(LEGACY_IDENTIFIER);
        if legacy.join(SAVE_FILE).exists() {
            let _ = copy_dir(&legacy, current);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(dir) = app.path().app_local_data_dir() {
                migrate_legacy_data(&dir);
                migrate_single_save(&dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_saves, load_save, write_save, write_match_log, read_match_log, delete_save, data_dir])
        .run(tauri::generate_context!())
        .expect("error while running Dominion League Manager");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_sanitised() {
        assert!(valid_id("s1-md03-2"));
        assert!(!valid_id("../evil"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
    }

    #[test]
    fn previous_save_is_kept_as_backup() {
        let dir = std::env::temp_dir().join(format!("dominion-bak-{}", std::process::id()));
        let path = dir.join(SAVE_FILE);
        backup_previous(&path); // nothing to back up yet: no panic
        atomic_write(&path, "{\"v\":1}").unwrap();
        backup_previous(&path);
        atomic_write(&path, "{\"v\":2}").unwrap();
        assert_eq!(read_optional(&path).unwrap().as_deref(), Some("{\"v\":2}"));
        assert_eq!(read_optional(&dir.join("season.bak.json")).unwrap().as_deref(), Some("{\"v\":1}"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_data_is_migrated_once() {
        let base = std::env::temp_dir().join(format!("dominion-mig-{}", std::process::id()));
        let legacy = base.join(LEGACY_IDENTIFIER);
        let current = base.join("com.dominionleague.manager");
        atomic_write(&legacy.join(SAVE_FILE), "{\"old\":1}").unwrap();
        atomic_write(&legacy.join(MATCH_DIR).join("m.json"), "{}").unwrap();
        migrate_legacy_data(&current);
        assert_eq!(read_optional(&current.join(SAVE_FILE)).unwrap().as_deref(), Some("{\"old\":1}"));
        assert!(current.join(MATCH_DIR).join("m.json").exists());
        assert!(legacy.join(SAVE_FILE).exists());
        atomic_write(&current.join(SAVE_FILE), "{\"new\":1}").unwrap();
        migrate_legacy_data(&current); // must not overwrite
        assert_eq!(read_optional(&current.join(SAVE_FILE)).unwrap().as_deref(), Some("{\"new\":1}"));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn single_save_moves_into_first_slot() {
        let dir = std::env::temp_dir().join(format!("dominion-slot-{}", std::process::id()));
        atomic_write(&dir.join(SAVE_FILE), "{\"s\":1}").unwrap();
        atomic_write(&dir.join(MATCH_DIR).join("m.json"), "{}").unwrap();
        migrate_single_save(&dir);
        let slot = dir.join(SAVES_DIR).join("game-1");
        assert_eq!(read_optional(&slot.join(SAVE_FILE)).unwrap().as_deref(), Some("{\"s\":1}"));
        assert!(slot.join(MATCH_DIR).join("m.json").exists());
        assert!(!dir.join(SAVE_FILE).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_round_trip_and_overwrite() {
        let dir = std::env::temp_dir().join(format!("dominion-test-{}", std::process::id()));
        let path = dir.join("matches").join("x.json");
        assert_eq!(read_optional(&path).unwrap(), None);
        atomic_write(&path, "{\"a\":1}").unwrap();
        atomic_write(&path, "{\"a\":2}").unwrap();
        assert_eq!(read_optional(&path).unwrap().as_deref(), Some("{\"a\":2}"));
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
