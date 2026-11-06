//! Desktop shell. All app logic lives in the TypeScript front end; this only provides a window,
//! file dialogs and file access for .world files and backups, and (AI-2, AI-4) the local
//! connector and runner for Claude Code.

mod claude;
mod http;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(claude::Shared::default())
        .invoke_handler(tauri::generate_handler![
            claude::claude_bridge_start,
            claude::claude_bridge_reply,
            claude::claude_version,
            claude::claude_ask,
            claude::claude_stop,
            claude::open_in_vscode,
            claude::open_claude_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Story World Tracker");
}
