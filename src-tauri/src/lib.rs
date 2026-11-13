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
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                use webkit2gtk::{WebContextExt, WebViewExt};
                // WebKitGTK leaves spell checking off; Windows' WebView2 has it on. Turn it on, British
                // and American English (the dictionaries come with the .deb's dependencies).
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.with_webview(|wv| {
                        if let Some(ctx) = wv.inner().context() {
                            ctx.set_spell_checking_enabled(true);
                            ctx.set_spell_checking_languages(&["en_GB", "en_US"]);
                        }
                    });
                }
            }
            #[cfg(not(target_os = "linux"))]
            let _ = app;
            Ok(())
        })
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
