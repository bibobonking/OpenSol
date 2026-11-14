//! OpenSol Desktop: starts (or reuses) the OpenSol daemon and shows its UI in the
//! operating system's own webview — WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_PORT: u16 = 4174;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// The daemon child we started ourselves; a daemon we merely reused is left running on exit.
struct Daemon(Mutex<Option<Child>>);

fn http_get(port: u16, path: &str) -> Option<String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(1200))).ok()?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut body = String::new();
    stream.read_to_string(&mut body).ok()?;
    Some(body)
}

/// A daemon already running on the default port with the same version can be shared with the web app.
fn reusable_daemon() -> Option<u16> {
    let body = http_get(DEFAULT_PORT, "/api/health")?;
    if body.contains(&format!("\"version\":\"{VERSION}\"")) && body.contains("\"dist\":true") {
        Some(DEFAULT_PORT)
    } else {
        None
    }
}

fn app_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(custom) = std::env::var("OPENSOL_APP_DIR") {
        candidates.push(PathBuf::from(custom));
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("app"));
    }
    // Running from a source checkout (cargo run inside desktop/src-tauri).
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../.."));
        candidates.push(cwd);
    }
    candidates
        .into_iter()
        .find(|dir| dir.join("server").join("daemon.mjs").is_file() && dir.join("dist").join("index.html").is_file())
}

fn node_binary() -> String {
    let name = if cfg!(windows) { "opensol-node.exe" } else { "opensol-node" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(name);
            if bundled.is_file() {
                return bundled.to_string_lossy().into_owned();
            }
        }
    }
    "node".to_string()
}

fn spawn_daemon(app_dir: &Path) -> Result<(Child, u16), String> {
    let node = node_binary();
    let mut command = Command::new(&node);
    command
        .arg(app_dir.join("server").join("daemon.mjs"))
        .arg("--port=0")
        .current_dir(app_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Node.js (\"{node}\"): {error}\nInstall Node.js 20+ or reinstall OpenSol Desktop."))?;
    let stdout = child.stdout.take().ok_or("The daemon has no output.")?;
    let (tx, rx) = std::sync::mpsc::channel::<u16>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(index) = line.find("listening on http://127.0.0.1:") {
                let port = line[index + "listening on http://127.0.0.1:".len()..].trim();
                if let Ok(port) = port.parse::<u16>() {
                    let _ = tx.send(port);
                }
            }
        }
    });
    match rx.recv_timeout(Duration::from_secs(25)) {
        Ok(port) => Ok((child, port)),
        Err(_) => {
            let _ = child.kill();
            Err("The OpenSol daemon did not start within 25 seconds.".to_string())
        }
    }
}

fn wait_until_healthy(port: u16) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(15) {
        if http_get(port, "/api/health").map(|body| body.contains("200")).unwrap_or(false) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn open_externally(url: &str) {
    let mut command = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg(url);
        c
    } else if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/c", "start", "", url]);
        #[cfg(windows)]
        c.creation_flags(0x0800_0000);
        c
    } else {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };
    let _ = command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

fn show_error(window: &tauri::WebviewWindow, message: &str) {
    let escaped = message.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n");
    let _ = window.eval(format!("window.__opensolError && window.__opensolError('{escaped}')"));
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(Daemon(Mutex::new(None)))
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("OpenSol")
                .inner_size(1360.0, 860.0)
                .min_inner_size(920.0, 600.0)
                .on_navigation(|url| {
                    let local = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("tauri.localhost"))
                        || url.scheme() == "tauri"
                        || url.scheme() == "about"
                        || url.scheme() == "blob"
                        || url.scheme() == "data";
                    if !local && matches!(url.scheme(), "http" | "https" | "mailto") {
                        open_externally(url.as_str());
                        return false;
                    }
                    true
                })
                .build()?;

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let outcome: Result<u16, String> = (|| {
                    if let Some(port) = reusable_daemon() {
                        return Ok(port);
                    }
                    let dir = app_dir(&handle).ok_or("OpenSol's app files were not found next to the installer.")?;
                    let (child, port) = spawn_daemon(&dir)?;
                    if let Some(state) = handle.try_state::<Daemon>() {
                        *state.0.lock().unwrap() = Some(child);
                    }
                    if !wait_until_healthy(port) {
                        return Err("The OpenSol daemon started but is not answering.".to_string());
                    }
                    Ok(port)
                })();
                if let Some(window) = handle.get_webview_window("main") {
                    match outcome {
                        Ok(port) => {
                            if let Ok(url) = format!("http://127.0.0.1:{port}/").parse() {
                                let _ = window.navigate(url);
                            }
                        }
                        Err(message) => show_error(&window, &message),
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenSol Desktop");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<Daemon>() {
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
