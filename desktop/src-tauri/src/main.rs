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
    diagnostic: bool,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendResponse {
    status: u16,
    headers: HashMap<String, String>,
    content_base64: String,
}

// Opt-in local development diagnostics; never enabled by a normal app launch.
// It records only structure/layout and snapshots this app's own WebView.
#[tauri::command]
fn native_render_report(
    window: tauri::WebviewWindow,
    mut report: serde_json::Value,
) -> Result<(), String> {
    let path = std::env::var_os("TOUDI_RENDER_REPORT").ok_or("渲染诊断未启用")?;
    report["nativePid"] = serde_json::json!(std::process::id());
    let text = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    if text.len() > 65536 {
        return Err("诊断超出范围".into());
    }
    std::fs::write(path, text).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    if let Some(path) = std::env::var_os("TOUDI_RENDER_SNAPSHOT") {
        window.with_webview(move |raw| unsafe {
            use objc2::{class, msg_send, runtime::AnyObject};
            let path = PathBuf::from(path);
            let completion = block2::RcBlock::new(move |image: *mut AnyObject, error: *mut AnyObject| {
                if image.is_null() || !error.is_null() { return; }
                let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
                if tiff.is_null() { return; }
                let bitmap: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
                let properties: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
                let png: *mut AnyObject = msg_send![bitmap, representationUsingType: 4_usize, properties: properties];
                if png.is_null() { return; }
                let bytes: *const u8 = msg_send![png, bytes];
                let length: usize = msg_send![png, length];
                let _ = std::fs::write(&path, std::slice::from_raw_parts(bytes, length));
            });
            let view: &AnyObject = &*raw.inner().cast();
            let _: () = msg_send![view, takeSnapshotWithConfiguration: std::ptr::null::<AnyObject>(), completionHandler: &*completion];
        }).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Ok(())
}

fn default_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn workspace_tool(tool: &PathBuf, args: &[&str]) -> Result<serde_json::Value, String> {
    let mut command = Command::new(tool);
    command.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    let result: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "资料工具未返回有效结果，请保留当前工作区。".to_string())?;
    if !output.status.success() || result["ok"] != true {
        return Err(result["error"].as_str().map(str::to_owned)
            .unwrap_or_else(|| format!("工作区尚未通过检查：{}", result["issues"])));
    }
    Ok(result)
}

fn workspace(tool: &PathBuf) -> Result<PathBuf, String> {
    let status = workspace_tool(tool, &["workspace", "status"])?;
    let path = status["workspace"].as_str().ok_or("工作区位置无效")?;
    Ok(PathBuf::from(path))
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
        diagnostic: std::env::var_os("TOUDI_RENDER_REPORT").is_some(),
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
fn open_filling() -> Result<(), String> {
    let url = "chrome-extension://edfgnahdkpobmkhckjhadadnlbhpbpmd/options.html";
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("open").args(["-a", "Google Chrome", url]).output()
            .map_err(|_| "未能打开 Chrome，请通过安装指南安装扩展。".to_string())?;
        if result.status.success() { return Ok(()); }
    }
    #[cfg(target_os = "windows")]
    {
        for key in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(key) {
                let chrome = PathBuf::from(base).join("Google/Chrome/Application/chrome.exe");
                if chrome.is_file() && Command::new(chrome).arg(url).spawn().is_ok() { return Ok(()); }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for binary in ["google-chrome", "chromium", "chromium-browser"] {
            if Command::new(binary).arg(url).spawn().is_ok() { return Ok(()); }
        }
    }
    Err("未能打开浏览器。请通过辅助填报安装指南安装 Chrome 和扩展。".into())
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
async fn select_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    if std::env::var_os("TOUDI_WORKSPACE").is_some() {
        return Err("本次启动已指定工作区；请结束此启动方式后再选择已有工作区。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let selection = app.dialog().file().set_title("选择 TouDi 资料工作区").blocking_pick_folder();
        let Some(selection) = selection else { return Ok(None); };
        let path = selection.into_path().map_err(|e| e.to_string())?;
        let text = path.to_string_lossy().to_string();
        let state = app.state::<AppState>();
        let mut current = state.0.lock().map_err(|e| e.to_string())?;
        workspace_tool(&current.tool, &["workspace", "check", &text])?;
        let mut replacement = Runtime {
            child: None, port: 0, token: String::new(), workspace: path,
            tool: current.tool.clone(), error: None,
        };
        if let Err(error) = spawn(&mut replacement) {
            stop(&mut replacement);
            return Err(error);
        }
        if let Err(error) = workspace_tool(&current.tool, &["workspace", "bind", &text]) {
            stop(&mut replacement);
            return Err(error);
        }
        stop(&mut current);
        *current = replacement;
        Ok(Some(text))
    }).await.map_err(|e| e.to_string())?
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
    let mut context = tauri::generate_context!();
    if std::env::var_os("TOUDI_RENDER_REPORT").is_some() {
        for window in &mut context.config_mut().app.windows {
            window.incognito = true;
            if let Ok(width) = std::env::var("TOUDI_RENDER_WIDTH") {
                if let Ok(width) = width.parse::<f64>() {
                    if (860.0..=1920.0).contains(&width) { window.width = width; }
                }
            }
            if let Ok(height) = std::env::var("TOUDI_RENDER_HEIGHT") {
                if let Ok(height) = height.parse::<f64>() {
                    if (600.0..=1200.0).contains(&height) { window.height = height; }
                }
            }
        }
    }
    let mut builder = tauri::Builder::default();
    if std::env::var_os("TOUDI_RENDER_REPORT").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_page_load(|webview, payload| {
            if std::env::var_os("TOUDI_RENDER_REPORT").is_some()
                && payload.event() == tauri::webview::PageLoadEvent::Finished
            {
                let webview = webview.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(2));
                    if let Ok(view) = std::env::var("TOUDI_RENDER_VIEW") {
                        if ["table","kanban","charts","qbank","company","prospect","review","settings","agent-settings","data-settings","preference-settings","education-preferences","industry-preferences","filling"].contains(&view.as_str()) {
                            let _ = webview.eval(format!("window.__TOUDI_DIAG_VIEW__ = '{view}';"));
                        }
                    }
                    let _ = webview.eval(include_str!("render_check.js"));
                });
            }
        })
        .setup(|app| {
            let resources = app.path().resource_dir()?;
            let name = if cfg!(target_os = "windows") {
                "toudi-runtime.exe"
            } else {
                "toudi-runtime"
            };
            let tool = resources.join("runtime/toudi-runtime").join(name);
            let selected = workspace(&tool);
            let root = match &selected {
                Ok(path) => path.clone(),
                Err(_) => default_workspace(app.handle()).map_err(std::io::Error::other)?,
            };
            let mut runtime = Runtime {
                child: None,
                port: 0,
                token: String::new(),
                workspace: root,
                tool,
                error: selected.err(),
            };
            if runtime.error.is_none() {
                if let Err(error) = spawn(&mut runtime) { runtime.error = Some(error); }
            }
            app.manage(AppState(Mutex::new(runtime)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_context,
            backend_request,
            restart_runtime,
            open_external,
            open_filling,
            show_workspace,
            select_workspace,
            save_file,
            export_reading,
            native_render_report
        ])
        .build(context)
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
