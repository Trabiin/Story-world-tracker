//! Ask Claude (AI-2, AI-4, AI-5). The app logic stays in the TypeScript front end; this file only
//! carries messages:
//! - a local MCP server for Claude Code (Streamable HTTP on 127.0.0.1): each request is handed to
//!   the front end as a "claude-mcp" event and the answer comes back through `claude_bridge_reply`;
//! - running Claude Code in the Claude folder for the in-app pane (`claude -p`, output streamed as
//!   "claude-out" events), and opening the folder in VS Code or a terminal.

use crate::http::{allowed, read_request, write_response};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const FIRST_PORT: u16 = 47820;
const PORTS: u16 = 20;
const ANSWER_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Default)]
pub struct Bridge {
    port: Mutex<Option<u16>>,
    pending: Mutex<HashMap<u64, Sender<(u16, String)>>>,
    runs: Mutex<HashMap<u64, Child>>,
    next: AtomicU64,
}

pub type Shared = Arc<Bridge>;

#[derive(Clone, Serialize)]
struct McpRequest {
    id: u64,
    auth: String,
    body: String,
}

#[derive(Clone, Serialize)]
struct RunLine {
    run: u64,
    line: String,
}

#[derive(Clone, Serialize)]
struct RunDone {
    run: u64,
    code: Option<i32>,
    error: String,
}

fn handle(app: &AppHandle, bridge: &Bridge, port: u16, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let req = match read_request(&mut stream) {
        Ok(r) => r,
        Err(e) => {
            let _ = write_response(&mut stream, 400, &e);
            return;
        }
    };
    if let Err((status, msg)) = allowed(&req, port) {
        let _ = write_response(&mut stream, status, msg);
        return;
    }
    let id = bridge.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = channel();
    bridge.pending.lock().unwrap().insert(id, tx);
    if app.emit("claude-mcp", McpRequest { id, auth: req.authorization, body: req.body }).is_err() {
        bridge.pending.lock().unwrap().remove(&id);
        let _ = write_response(&mut stream, 503, "The app is not ready");
        return;
    }
    let (status, body) = rx.recv_timeout(ANSWER_TIMEOUT).unwrap_or((504, "The app did not answer in time".into()));
    bridge.pending.lock().unwrap().remove(&id);
    let status = if status == 200 && body.is_empty() { 202 } else { status };
    let _ = write_response(&mut stream, status, &body);
}

/// AI-2: start the local connector (once) and return its port.
#[tauri::command]
pub fn claude_bridge_start(app: AppHandle, state: State<'_, Shared>) -> Result<u16, String> {
    let bridge = state.inner().clone();
    if let Some(p) = *bridge.port.lock().unwrap() {
        return Ok(p);
    }
    let (listener, port) = (FIRST_PORT..FIRST_PORT + PORTS)
        .find_map(|p| TcpListener::bind(("127.0.0.1", p)).ok().map(|l| (l, p)))
        .ok_or("No free port for the Claude connector (47820–47839)")?;
    *bridge.port.lock().unwrap() = Some(port);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let bridge = bridge.clone();
            std::thread::spawn(move || handle(&app, &bridge, port, stream));
        }
    });
    Ok(port)
}

/// The front end's answer to one connector request. status 200 with an empty body = a notification (HTTP 202).
#[tauri::command]
pub fn claude_bridge_reply(state: State<'_, Shared>, id: u64, status: u16, body: String) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send((status, body));
    }
}

#[cfg(windows)]
fn quiet(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}
#[cfg(not(windows))]
fn quiet(cmd: &mut Command) -> &mut Command {
    cmd
}

/// Claude Code's own installer puts claude.exe in %USERPROFILE%\.local\bin; npm installs claude.cmd
/// on the PATH. Find either, so the app works however it was installed.
fn claude_command() -> Command {
    #[cfg(windows)]
    {
        if let Ok(home) = std::env::var("USERPROFILE") {
            let exe = std::path::Path::new(&home).join(".local").join("bin").join("claude.exe");
            if exe.exists() {
                return Command::new(exe);
            }
        }
        if let Ok(path) = std::env::var("PATH") {
            for dir in std::env::split_paths(&path) {
                if dir.join("claude.exe").exists() {
                    return Command::new(dir.join("claude.exe"));
                }
            }
        }
        let mut c = Command::new("cmd");
        c.args(["/D", "/S", "/C", "claude"]);
        c
    }
    #[cfg(not(windows))]
    {
        // Claude Code's own installer puts it in ~/.local/bin, which a desktop app's PATH often lacks.
        if let Ok(home) = std::env::var("HOME") {
            let bin = std::path::Path::new(&home).join(".local").join("bin").join("claude");
            if bin.exists() {
                return Command::new(bin);
            }
        }
        Command::new("claude")
    }
}

/// AI-5: is Claude Code installed? Returns its version.
#[tauri::command]
pub async fn claude_version() -> Result<String, String> {
    let out = quiet(claude_command().arg("--version")).output().map_err(|e| format!("Claude Code was not found ({e})"))?;
    if !out.status.success() {
        return Err("Claude Code was not found. Install it, then press Check again.".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// AI-4: ask Claude Code a question in the Claude folder. Output arrives as "claude-out" events
/// (one stream-json line each), then "claude-done". session: continue that conversation.
#[tauri::command]
pub fn claude_ask(app: AppHandle, state: State<'_, Shared>, folder: String, prompt: String, session: Option<String>, model: Option<String>) -> Result<u64, String> {
    let bridge = state.inner().clone();
    let mut cmd = claude_command();
    cmd.current_dir(&folder)
        .args(["-p", "--output-format", "stream-json", "--verbose", "--mcp-config", ".mcp.json", "--allowedTools", "mcp__story-world,Read,Glob,Grep", "--disallowedTools", "Edit,Write,NotebookEdit,Bash"]);
    if let Some(s) = session.filter(|s| !s.is_empty()) {
        cmd.args(["--resume", &s]);
    }
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        cmd.args(["--model", &m]);
    }
    let mut child = quiet(cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()))
        .spawn()
        .map_err(|e| format!("Could not start Claude Code: {e}"))?;
    // The question goes in on stdin, so no quoting rules of the shell can get in the way.
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    }
    let run = bridge.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    bridge.runs.lock().unwrap().insert(run, child);
    let err_text = Arc::new(Mutex::new(String::new()));
    if let Some(err) = stderr {
        let err_text = err_text.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let mut t = err_text.lock().unwrap();
                if t.len() < 4000 {
                    t.push_str(&line);
                    t.push('\n');
                }
            }
        });
    }
    std::thread::spawn(move || {
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = app.emit("claude-out", RunLine { run, line });
            }
        }
        let code = bridge.runs.lock().unwrap().remove(&run).and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        std::thread::sleep(Duration::from_millis(100));
        let error = err_text.lock().unwrap().clone();
        let _ = app.emit("claude-done", RunDone { run, code, error });
    });
    Ok(run)
}

#[tauri::command]
pub fn claude_stop(state: State<'_, Shared>, run: u64) {
    if let Some(c) = state.runs.lock().unwrap().get_mut(&run) {
        let _ = c.kill();
    }
}

/// AI-4: "Open in VS Code".
#[tauri::command]
pub fn open_in_vscode(folder: String) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/D", "/C", "code", "."]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("code");
        c.arg(".");
        c
    };
    quiet(cmd.current_dir(&folder)).spawn().map(|_| ()).map_err(|e| format!("Could not start VS Code: {e}. Is it installed, with \"code\" on the PATH?"))
}

/// AI-4: Claude Code in its own terminal window, in the Claude folder.
#[tauri::command]
pub fn open_claude_terminal(folder: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/D", "/C", "start", "Claude Code", "/D", &folder, "cmd", "/K", "claude"])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open a terminal: {e}"))
    }
    #[cfg(not(windows))]
    {
        // Linux (also a Chromebook's Linux): the first terminal program that is installed.
        let script = "claude; exec bash";
        let tries: [(&str, &[&str]); 4] = [
            ("x-terminal-emulator", &["-e", "bash", "-c"]),
            ("gnome-terminal", &["--", "bash", "-c"]),
            ("konsole", &["-e", "bash", "-c"]),
            ("xterm", &["-e", "bash", "-c"]),
        ];
        for (prog, args) in tries {
            if Command::new(prog).args(args).arg(script).current_dir(&folder).spawn().is_ok() {
                return Ok(());
            }
        }
        Err(format!("No terminal program was found. Open the Terminal app, then type: cd \"{folder}\" && claude"))
    }
}
