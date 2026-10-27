use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use rand::Rng;
use tauri::path::BaseDirectory;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Owned so the shell host dies with the window instead of outliving it.
struct PtyHost(Mutex<Option<Child>>);

fn secret_token() -> String {
    let bytes: [u8; 24] = rand::thread_rng().gen();
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr().map(|address| address.port()))
        .unwrap_or(53124)
}

/// localStorage is origin-scoped, so the page origin (port included) must stay
/// stable or saved theme/shortcut preferences disappear on every launch. An
/// elevated relaunch starts while the old instance is still shutting down, so
/// give the previous host a few seconds to release the port.
fn host_port() -> u16 {
    const PREFERRED: u16 = 53125;
    for _ in 0..24 {
        if TcpListener::bind(("127.0.0.1", PREFERRED)).is_ok() {
            return PREFERRED;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    free_port()
}

fn bundled_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("macterm", BaseDirectory::Resource)
        .map_err(|error| error.to_string())
}

/// Prefers the Node runtime shipped inside the installer so a release build
/// needs no system Node; falls back to PATH for an unpackaged run.
fn node_binary(app: &tauri::AppHandle) -> String {
    if let Ok(explicit) = std::env::var("MACTERM_NODE") {
        return explicit;
    }
    if let Ok(bundled) = app
        .path()
        .resolve("macterm-runtime/node.exe", BaseDirectory::Resource)
    {
        if bundled.is_file() {
            return bundled.to_string_lossy().into_owned();
        }
    }
    "node".to_string()
}

fn spawn_host(node: &str, root: &PathBuf, port: u16, token: &str) -> Result<Child, String> {
    let mut command = Command::new(node);
    command
        .arg("server/index.ts")
        .current_dir(root)
        .env("MACTERM_PORT", port.to_string())
        .env("MACTERM_TOKEN", token)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    // The host needs to know which executable to elevate when the shield button
    // asks Windows for administrator rights.
    if let Ok(exe) = std::env::current_exe() {
        command.env("MACTERM_APP_EXE", exe);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn().map_err(|error| {
        format!(
            "macterm could not start its shell host with `{node}` ({error}).\n\
             Install Node 20.19+ or set MACTERM_NODE to your node executable."
        )
    })
}

fn wait_for_host(port: u16) -> bool {
    for _ in 0..100 {
        if TcpListener::bind(("127.0.0.1", port)).is_err() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    false
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = bundled_root(&app.handle())?;
            let port = host_port();
            let token = secret_token();

            let child = spawn_host(&node_binary(&app.handle()), &root, port, &token)?;
            app.manage(PtyHost(Mutex::new(Some(child))));

            if !wait_for_host(port) {
                return Err("the shell host never came up".into());
            }

            let address = format!("http://127.0.0.1:{port}/?token={token}");
            let url: tauri::Url = address
                .parse()
                .map_err(|error| format!("bad host url: {error}"))?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("macterm")
                .decorations(false)
                .transparent(true)
                // The Win10 shadow fills the transparent corners, which shows up
                // as dark square ears behind the CSS radius.
                .shadow(false)
                .inner_size(980.0, 620.0)
                .min_inner_size(420.0, 220.0)
                .center()
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build macterm")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<PtyHost>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
