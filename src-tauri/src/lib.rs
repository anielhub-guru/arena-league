use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SAVE_FILE: &str = "season.json";
const MATCH_DIR: &str = "matches";

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

#[tauri::command]
fn load_save(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&root(&app)?.join(SAVE_FILE))
}

#[tauri::command]
fn write_save(app: AppHandle, json: String) -> Result<(), String> {
    let path = root(&app)?.join(SAVE_FILE);
    backup_previous(&path);
    atomic_write(&path, &json)
}

#[tauri::command]
fn write_match_log(app: AppHandle, id: String, json: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid match id".into());
    }
    atomic_write(&root(&app)?.join(MATCH_DIR).join(format!("{id}.json")), &json)
}

#[tauri::command]
fn read_match_log(app: AppHandle, id: String) -> Result<Option<String>, String> {
    if !valid_id(&id) {
        return Err("invalid match id".into());
    }
    read_optional(&root(&app)?.join(MATCH_DIR).join(format!("{id}.json")))
}

#[tauri::command]
fn reset_save(app: AppHandle) -> Result<(), String> {
    let dir = root(&app)?;
    match fs::remove_file(dir.join(SAVE_FILE)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    match fs::remove_dir_all(dir.join(MATCH_DIR)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn data_dir(app: AppHandle) -> Result<String, String> {
    Ok(root(&app)?.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_save, write_save, write_match_log, read_match_log, reset_save, data_dir])
        .run(tauri::generate_context!())
        .expect("error while running Arena League Manager");
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
        let dir = std::env::temp_dir().join(format!("arena-bak-{}", std::process::id()));
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
    fn save_round_trip_and_overwrite() {
        let dir = std::env::temp_dir().join(format!("arena-test-{}", std::process::id()));
        let path = dir.join("matches").join("x.json");
        assert_eq!(read_optional(&path).unwrap(), None);
        atomic_write(&path, "{\"a\":1}").unwrap();
        atomic_write(&path, "{\"a\":2}").unwrap();
        assert_eq!(read_optional(&path).unwrap().as_deref(), Some("{\"a\":2}"));
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
