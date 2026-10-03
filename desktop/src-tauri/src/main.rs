#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct Runtime {
    child: Option<Child>,
    port: u16,
    token: String,
    workspace: PathBuf,
    tool: PathBuf,
    error: Option<String>,
}
struct AppState(Mutex<Runtime>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    workspace: String,
    agent_tool: String,
    guide_root: String,
    version: String,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendResponse {
    status: u16,
    headers: HashMap<String, String>,
    content_base64: String,
}

fn workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("TOUDI_WORKSPACE") {
        return Ok(PathBuf::from(path));
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let root = home.join("Library/Application Support/TouDi/workspace");
    #[cfg(target_os = "windows")]
    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData/Local"))
        .join("TouDi/workspace");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"))
        .join("toudi/workspace");
    Ok(root)
}

fn spawn(runtime: &mut Runtime) -> Result<(), String> {
    std::fs::create_dir_all(&runtime.workspace).map_err(|e| e.to_string())?;
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    runtime.token = random.iter().map(|b| format!("{b:02x}")).collect();
    let mut command = Command::new(&runtime.tool);
    command
        .arg("serve")
        .env("TOUDI_WORKSPACE", &runtime.workspace)
        .env("TOUDI_DESKTOP_TOKEN", &runtime.token)
        .env("TOUDI_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("运行组件无法启动：{e}"))?;
    let stdout = child.stdout.take().ok_or("运行组件没有就绪通道")?;
    let stderr = child.stderr.take().ok_or("运行组件没有诊断通道")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                if value["event"] == "ready" {
                    let _ = tx.send(value["port"].as_u64().unwrap_or(0) as u16);
                }
            }
        }
    });
    // Drain diagnostics without exposing material contents or ephemeral credentials in the UI.
    std::thread::spawn(
        move || {
            for _ in BufReader::new(stderr).lines().map_while(Result::ok) {}
        },
    );
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(port) if port > 0 => {
            runtime.port = port;
            runtime.child = Some(child);
            runtime.error = None;
            Ok(())
        }
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            Err("运行组件未就绪，请保留工作区并重试。".into())
        }
    }
}

fn stop(runtime: &mut Runtime) {
    if let Some(mut child) = runtime.child.take() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"shutdown\n");
        }
        for _ in 0..100 {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
fn desktop_context(state: State<AppState>) -> Result<Context, String> {
    let r = state.0.lock().map_err(|e| e.to_string())?;
    let guide_root = r.tool.parent().ok_or("运行组件位置无效")?.join("_internal");
    Ok(Context {
        workspace: r.workspace.to_string_lossy().into(),
        agent_tool: r.tool.to_string_lossy().into(),
        guide_root: guide_root.to_string_lossy().into(),
        version: env!("CARGO_PKG_VERSION").into(),
        error: r.error.clone(),
    })
}

#[tauri::command]
async fn backend_request(
    path: String,
    method: String,
    body: Option<String>,
    state: State<'_, AppState>,
) -> Result<BackendResponse, String> {
    if !(path == "/" || path == "/投递管理.html" || path.starts_with("/api/"))
        || path.contains('\r')
        || path.contains('\n')
        || path.contains('#')
    {
        return Err("不支持的资料接口".into());
    }
    if !["GET", "POST", "OPTIONS"].contains(&method.as_str()) {
        return Err("不支持的操作".into());
    }
    if body.as_ref().is_some_and(|b| b.len() > 32 * 1024 * 1024) {
        return Err("提交内容超过单次限制，请分批导入。".into());
    }
    let (port, token) = {
        let r = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &r.error {
            return Err(error.clone());
        }
        (r.port, r.token.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        let url = format!("http://127.0.0.1:{port}{path}");
        let mut request = client
            .request(
                method
                    .parse::<reqwest::Method>()
                    .map_err(|e| e.to_string())?,
                url,
            )
            .bearer_auth(token)
            .header("Origin", format!("http://127.0.0.1:{port}"));
        if let Some(data) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(data);
        }
        let response = request
            .send()
            .map_err(|_| "运行组件暂时无法连接，请重开应用；待提交草稿会保留。".to_string())?;
        let status = response.status().as_u16();
        let mut headers = HashMap::new();
        for key in ["content-type", "content-disposition"] {
            if let Some(value) = response.headers().get(key).and_then(|v| v.to_str().ok()) {
                headers.insert(key.into(), value.into());
            }
        }
        let bytes = response.bytes().map_err(|e| e.to_string())?;
        if bytes.len() > 128 * 1024 * 1024 {
            return Err("导出内容超过应用单次传输范围。".into());
        }
        Ok(BackendResponse {
            status,
            headers,
            content_base64: STANDARD.encode(bytes),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn restart_runtime(state: State<AppState>) -> Result<(), String> {
    let mut r = state.0.lock().map_err(|e| e.to_string())?;
    stop(&mut r);
    let result = spawn(&mut r);
    if let Err(error) = &result {
        r.error = Some(error.clone());
    }
    result
}

#[tauri::command]
fn open_external(url: String, app: tauri::AppHandle) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err("只支持网页或邮件链接".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_workspace(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    let path = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .workspace
        .to_string_lossy()
        .to_string();
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_file(
    name: String,
    content_base64: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let safe = PathBuf::from(name)
            .file_name()
            .ok_or("导出文件名无效")?
            .to_string_lossy()
            .to_string();
        let bytes = STANDARD.decode(content_base64).map_err(|e| e.to_string())?;
        if bytes.len() > 128 * 1024 * 1024 {
            return Err("导出超过单次范围".into());
        }
        let selection = app.dialog().file().set_file_name(safe).blocking_save_file();
        let Some(selection) = selection else {
            return Ok(false);
        };
        let path = selection.into_path().map_err(|e| e.to_string())?;
        // The native save dialog confirms replacement before this write.
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).map_err(|e| e.to_string())?;
        let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let temporary = path.with_file_name(format!(".toudi-export-{suffix}.tmp"));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        let written = file.write_all(&bytes).and_then(|_| file.sync_all());
        drop(file);
        let result = written.and_then(|_| std::fs::rename(&temporary, &path));
        let _ = std::fs::remove_file(&temporary);
        result.map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_reading(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let (tool, root) = {
        let r = state.0.lock().map_err(|e| e.to_string())?;
        (r.tool.clone(), r.workspace.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selection)=app.dialog().file().set_file_name("TouDi-加密查阅版.zip").blocking_save_file() else {return Ok(serde_json::json!({"cancelled":true}));};
        let path=selection.into_path().map_err(|e| e.to_string())?;
        let mut command=Command::new(tool);command.arg("export-reading").arg(&path).env("TOUDI_WORKSPACE",&root);
        #[cfg(target_os="windows")]
        {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
        let result=command.output().map_err(|e| e.to_string())?;
        if !result.status.success(){return Err("查阅版生成失败，正式资料仍保留。".into());}
        Ok(serde_json::json!({"ok":true,"output":path,"passcodeFile":root.join("投递数据/手机版/.passcode")}))
    }).await.map_err(|e| e.to_string())?
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = workspace(app.handle()).map_err(std::io::Error::other)?;
            let resources = app.path().resource_dir()?;
            let name = if cfg!(target_os = "windows") {
                "toudi-runtime.exe"
            } else {
                "toudi-runtime"
            };
            let tool = resources.join("runtime/toudi-runtime").join(name);
            let mut runtime = Runtime {
                child: None,
                port: 0,
                token: String::new(),
                workspace: root,
                tool,
                error: None,
            };
            if let Err(error) = spawn(&mut runtime) {
                runtime.error = Some(error);
            }
            app.manage(AppState(Mutex::new(runtime)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_context,
            backend_request,
            restart_runtime,
            open_external,
            show_workspace,
            save_file,
            export_reading
        ])
        .build(tauri::generate_context!())
        .expect("TouDi desktop could not initialize");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut r) = state.0.lock() {
                    stop(&mut r);
                }
            }
        }
    });
}
