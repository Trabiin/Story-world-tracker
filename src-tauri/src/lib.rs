//! Desktop shell. All app logic lives in the TypeScript front end; this only provides
//! a window plus file dialogs and file access for .world files and backups.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Story World Tracker");
}
