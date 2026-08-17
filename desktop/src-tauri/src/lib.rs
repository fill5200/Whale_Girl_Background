// Tauri 渲染壳：透明置顶窗 + Node 引擎子进程（--render-json）桥。
//
// 职责与 Electron main（lib/render/window.mjs）对齐：
// - 拉起引擎子进程，stdout JSON 行（anim/snapshot/reply/ready）→ Tauri 事件
// - 命令面（webview invoke）：get_manifest / get_sheet（资产经本进程拉取转 dataURL，
//   与 Electron 的「渲染层零网络」一致）/ interact（写引擎 stdin）/ set_hitarea（点击穿透）/
//   drag_window（移动窗口）
// - 资产拉取用 ureq（原生 HTTP，无 CORS 面）
use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager, Window};

/// 引擎子进程句柄（stdin 写 interact/stop 命令）。
struct Engine(Mutex<Option<Child>>);

/// 运行态（引擎地址等）。
#[derive(Clone, Serialize)]
struct AppState {
    base_url: String,
}

#[tauri::command]
fn get_manifest(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let url = format!("{}/whale-girl/assets/manifest.json", state.base_url);
    let body = ureq::get(&url)
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_sheet(state: tauri::State<AppState>, character_id: String, sheet: String) -> Result<String, String> {
    // sheet 含扩展名（manifest cfg.sheet），路径随角色目录；与主仓 assets 路由契约一致。
    let url = format!(
        "{}/whale-girl/assets/characters/{}/{}",
        state.base_url, character_id, sheet
    );
    let mut bytes: Vec<u8> = Vec::new();
    ureq::get(&url)
        .call()
        .map_err(|e| e.to_string())?
        .into_reader()
        .take(16 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[tauri::command]
fn interact(engine: tauri::State<Engine>, action: String) {
    let line = format!("{{\"type\":\"interact\",\"action\":\"{}\"}}\n", action);
    if let Some(child) = engine.0.lock().unwrap().as_mut() {
        if let Some(stdin) = child.stdin.as_mut() {
            let _ = stdin.write_all(line.as_bytes());
        }
    }
}

#[tauri::command]
fn set_hitarea(window: Window, rect: Option<serde_json::Value>) {
    // 有内容 bbox → 可交互（点击投喂/拖拽）；null（占位/空）→ 点击穿透。
    let _ = window.set_ignore_cursor_events(rect.is_none());
}

#[tauri::command]
fn drag_window(window: Window, dx: f64, dy: f64) {
    if let Ok(pos) = window.outer_position() {
        let _ = window.set_position(tauri::PhysicalPosition::new(
            pos.x + dx as i32,
            pos.y + dy as i32,
        ));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base_url = std::env::var("WHALE_GIRL_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3080".to_string());

    tauri::Builder::default()
        .manage(AppState {
            base_url: base_url.clone(),
        })
        .setup(move |app| {
            // 拉起 Node 引擎（--render-json）：stdout JSON 行 → Tauri 事件。
            // 引擎路径按源码树相对本 manifest 目录解析（交付方式 A：仓库目录运行）。
            let engine_main = Path::new(env!("CARGO_MANIFEST_DIR")).join("../lib/index.mjs");
            let mut child = Command::new("node")
                .arg(&engine_main)
                .arg("--render-json")
                .arg(format!("--base-url={base_url}"))
                .stdout(Stdio::piped())
                .stdin(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| format!("启动引擎失败（需要 node 在 PATH）: {e}"))?;
            let stdout = child.stdout.take().expect("engine stdout");
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    match msg.get("type").and_then(|v| v.as_str()) {
                        Some("anim") => {
                            let _ = handle.emit("wg-anim", &msg);
                        }
                        Some("snapshot") => {
                            let _ = handle.emit("wg-snapshot", msg.get("snapshot"));
                        }
                        Some("reply") => {
                            let _ = handle.emit("wg-reply", msg.get("reply"));
                        }
                        _ => {}
                    }
                }
            });
            app.manage(Engine(Mutex::new(Some(child))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_manifest,
            get_sheet,
            interact,
            set_hitarea,
            drag_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
