use serde::Serialize;
use std::io::Write;
use tauri::Manager;
use sha2::{Digest, Sha256};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

// Windows 下隐藏后台子进程的控制台窗口，避免检测时疯狂弹出 cmd/powershell 黑窗。
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "macos")]
fn escape_applescript(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

#[cfg(not(target_os = "windows"))]
fn shell_path_prefix() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return String::new();
    }

    format!(
        "export PATH=\"{home}/.local/bin:{home}/.npm-global/bin:{home}/bin:{home}/.cargo/bin:$PATH\"; "
    )
}

/// 一键安装 AI CLI 工具：打开终端并执行官方安装命令。
/// 在系统终端中执行给定命令（前端根据当前系统传入对应命令）。
/// 这样新增工具只需在前端的 tools.ts 加一条，无需改后端。
#[tauri::command]
fn run_in_terminal(command: String, tool_id: Option<String>) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("该工具暂不支持当前系统的一键安装，请参考官网".to_string());
    }

    // 若该工具配置过本地 API，则启动前 source 对应 env 文件（仅 Unix shell）
    #[cfg(not(target_os = "windows"))]
    let env_prefix = tool_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty() && !id.contains(['/', '\\', '.', '\0']))
        .map(|id| {
            format!(
                "if [ -f \"$HOME/.config/ai-lite/{id}.env\" ]; then . \"$HOME/.config/ai-lite/{id}.env\"; fi; "
            )
        })
        .unwrap_or_default();
    #[cfg(target_os = "windows")]
    let _ = &tool_id;

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
            escape_applescript(&format!("{env_prefix}{command}"))
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("打开终端失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("powershell")
            .args(["-NoExit", "-Command", command])
            .spawn()
            .map_err(|e| format!("打开终端失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let shell_command = format!("{}{env_prefix}{}; exec bash", shell_path_prefix(), command);
        std::process::Command::new("x-terminal-emulator")
            .args(["-e", "bash", "-lc", &shell_command])
            .spawn()
            .or_else(|_| {
                std::process::Command::new("gnome-terminal")
                    .args(["--", "bash", "-lc", &shell_command])
                    .spawn()
            })
            .or_else(|_| {
                std::process::Command::new("konsole")
                    .args(["-e", "bash", "-lc", &shell_command])
                    .spawn()
            })
            .map_err(|e| format!("打开终端失败: {}", e))?;
    }

    Ok("已在终端开始执行".to_string())
}

#[tauri::command]
fn command_exists(commands: Vec<String>) -> Result<bool, String> {
    for command in commands {
        let command = command.trim();
        if command.is_empty()
            || command.contains('/')
            || command.contains('\\')
            || command.contains('\0')
        {
            continue;
        }

        #[cfg(target_os = "windows")]
        let output = std::process::Command::new("where")
            .arg(command)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("检测命令失败: {}", e))?;

        #[cfg(not(target_os = "windows"))]
        let output = std::process::Command::new("bash")
            .args([
                "-lc",
                &format!(
                    "{}command -v '{}' >/dev/null 2>&1",
                    shell_path_prefix(),
                    command.replace('\'', "'\\''")
                ),
            ])
            .output()
            .map_err(|e| format!("检测命令失败: {}", e))?;

        if output.status.success() {
            return Ok(true);
        }
    }

    Ok(false)
}

/// 获取已安装工具的版本号（运行 `<cmd> --version` 取首行）。
#[tauri::command]
fn get_tool_version(command: String) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty()
        || command.contains('/')
        || command.contains('\\')
        || command.contains('\0')
    {
        return Err("命令不合法".to_string());
    }

    #[cfg(target_os = "windows")]
    let output = std::process::Command::new(command)
        .arg("--version")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("执行失败: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("bash")
        .args([
            "-lc",
            &format!(
                "{}'{}' --version 2>&1 | head -1",
                shell_path_prefix(),
                command.replace('\'', "'\\''")
            ),
        ])
        .output()
        .map_err(|e| format!("执行失败: {}", e))?;

    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next().unwrap_or("").trim().to_string();
    if first.is_empty() {
        return Err("无版本信息".to_string());
    }
    Ok(first)
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[tauri::command]
fn save_tool_api_config(
    tool_id: String,
    api_key: String,
    base_url: String,
    model: String,
    key_var: String,
    base_url_var: String,
    model_var: String,
    extra_key_vars: Vec<String>,
) -> Result<String, String> {
    let tool_id = tool_id.trim();
    let api_key = api_key.trim();
    let base_url = base_url.trim();
    let model = model.trim();

    if tool_id.is_empty() || tool_id.contains(['/', '\\', '.', '\0']) {
        return Err("工具标识不合法".to_string());
    }
    if api_key.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    if base_url.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    if key_var.trim().is_empty() || base_url_var.trim().is_empty() {
        return Err("缺少环境变量名".to_string());
    }

    let mut content = String::new();
    content.push_str(&format!("export {}={}\n", key_var.trim(), shell_single_quote(api_key)));
    content.push_str(&format!("export {}={}\n", base_url_var.trim(), shell_single_quote(base_url)));
    if !model.is_empty() && !model_var.trim().is_empty() {
        content.push_str(&format!("export {}={}\n", model_var.trim(), shell_single_quote(model)));
    }
    for var in extra_key_vars {
        let var = var.trim();
        if !var.is_empty() {
            content.push_str(&format!("export {}={}\n", var, shell_single_quote(api_key)));
        }
    }

    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 目录".to_string())?;
    let dir = std::path::PathBuf::from(home).join(".config/ai-lite");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;

    let path = dir.join(format!("{}.env", tool_id));
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|e| format!("写入配置失败: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入配置失败: {}", e))?;

    #[cfg(unix)]
    {
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("设置配置权限失败: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_in_app_browser(app: tauri::AppHandle, url: String, title: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只能打开 http/https 地址".to_string());
    }

    let parsed_url = url
        .parse()
        .map_err(|e| format!("网址格式不正确: {}", e))?;
    let label = format!(
        "web-{}",
        url.bytes()
            .fold(0_u64, |hash, byte| hash.wrapping_mul(31).wrapping_add(byte as u64))
    );

    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| format!("聚焦窗口失败: {}", e))?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(parsed_url))
        .title(if title.trim().is_empty() { "AI Lite 浏览" } else { title.trim() })
        .inner_size(1180.0, 820.0)
        .min_inner_size(760.0, 520.0)
        .build()
        .map_err(|e| format!("打开内置浏览窗口失败: {}", e))?;

    Ok(())
}

#[derive(Serialize)]
struct ChatReply {
    content: String,
}

/// 调用 OpenAI 兼容的 /chat/completions 接口，返回回复文本。
/// 在后端发请求可避免浏览器 CORS 限制。
#[tauri::command]
async fn call_api(
    base_url: String,
    api_key: String,
    model: String,
    message: String,
) -> Result<ChatReply, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": message }],
    });

    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!("接口返回 {}: {}", status, text));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {}", e))?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("响应缺少回复内容: {}", text))?
        .to_string();

    Ok(ChatReply { content })
}

/// 读取 Codex Lite 的本地 API 访问配置（端口 + token），供前端拉取模型列表用。
#[tauri::command]
fn read_local_access() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").map_err(|_| "无法获取 HOME 目录".to_string())?;
    let path = std::path::PathBuf::from(home)
        .join(".antigravity_cockpit/codex_local_access.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取本地 API 配置失败（Codex Lite 是否在运行？）: {}", e))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析本地 API 配置失败: {}", e))?;
    let enabled = json["enabled"].as_bool().unwrap_or(false);
    let port = json["port"].as_u64().unwrap_or(0);
    let api_key = json["apiKey"].as_str().unwrap_or("").to_string();
    Ok(serde_json::json!({
        "enabled": enabled,
        "baseUrl": format!("http://127.0.0.1:{}/v1", port),
        "token": api_key,
    }))
}

/// 拉取 OpenAI 兼容服务的模型列表（GET /v1/models）。
#[tauri::command]
async fn list_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let mut req = reqwest::Client::new().get(&url);
    let key = api_key.trim();
    if !key.is_empty() {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    if !status.is_success() {
        return Err(format!("接口返回 {}: {}", status, text));
    }
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {}", e))?;
    let models = json["data"]
        .as_array()
        .ok_or_else(|| format!("响应缺少模型列表: {}", text))?
        .iter()
        .filter_map(|m| m["id"].as_str().map(String::from))
        .collect();
    Ok(models)
}

/// 端点连通性检测：请求 /models，返回是否可达及状态说明。
#[tauri::command]
async fn check_endpoint(base_url: String, api_key: String) -> Result<String, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let mut req = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(8));
    let key = api_key.trim();
    if !key.is_empty() {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await.map_err(|e| format!("无法连接: {}", e))?;
    let status = resp.status();
    if status.is_success() {
        Ok(format!("可用（{}）", status.as_u16()))
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        Ok(format!("可达，但鉴权失败（{}）", status.as_u16()))
    } else {
        Err(format!("端点返回 {}", status.as_u16()))
    }
}

/// 环境体检：检查若干命令是否存在、版本，以及 relay 端口、本地 API。
#[tauri::command]
fn run_diagnostics() -> Result<Vec<(String, bool, String)>, String> {
    let mut out: Vec<(String, bool, String)> = Vec::new();

    // 命令存在性 + 版本
    for (label, cmd) in [
        ("Node.js", "node"),
        ("npm", "npm"),
        ("Python", "python3"),
        ("pip", "pip3"),
        ("codex-relay", "codex-relay"),
    ] {
        match get_tool_version(cmd.to_string()) {
            Ok(v) => out.push((label.to_string(), true, v)),
            Err(_) => out.push((label.to_string(), false, "未安装".to_string())),
        }
    }

    // 本地 API 配置
    let home = std::env::var("HOME").unwrap_or_default();
    let access_path =
        std::path::PathBuf::from(&home).join(".antigravity_cockpit/codex_local_access.json");
    if let Ok(text) = std::fs::read_to_string(&access_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            let enabled = json["enabled"].as_bool().unwrap_or(false);
            let port = json["port"].as_u64().unwrap_or(0);
            out.push((
                "本地 API (Codex Lite)".to_string(),
                enabled,
                if enabled {
                    format!("已启用，端口 {}", port)
                } else {
                    "未启用".to_string()
                },
            ));
        }
    } else {
        out.push(("本地 API (Codex Lite)".to_string(), false, "未找到配置".to_string()));
    }

    Ok(out)
}

/// 读取日志文件内容（限定 /tmp 下的 ai-lite/codex-relay 日志）。
#[tauri::command]
fn read_log(name: String) -> Result<String, String> {
    let dir = std::env::temp_dir();
    let path = match name.as_str() {
        "relay" => dir.join("codex-relay.log"),
        "app" => dir.join("ai-lite-run.log"),
        _ => return Err("未知日志".to_string()),
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            let tail: String = text.lines().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            Ok(tail)
        }
        Err(_) => Ok("（暂无日志）".to_string()),
    }
}

// ===== 解锁门：盐与 Codex Lite 一致（共用同一个解码器），机器码各软件独立 =====
const UNLOCK_SALT: &str = "codex-lite-unlock-v1:7c5a9e41d8f64b32";
const UNLOCK_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

fn unlock_normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn unlock_chunks(value: &str) -> String {
    value
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

fn unlock_machine_code() -> String {
    // ai-lite 独立的设备种子（带软件标识，使机器码区别于 Codex Lite）
    let home = std::env::var("HOME").unwrap_or_default();
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    let seed = format!("ai-lite-device|{}|{}|{}", home, host, user);
    let digest = Sha256::digest(seed.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{:02X}", b)).collect();
    unlock_chunks(&hex[..12])
}

fn unlock_expected_code(machine_code: &str) -> String {
    let norm = unlock_normalize(machine_code);
    let digest = Sha256::digest(format!("{}|{}", UNLOCK_SALT, norm).as_bytes());
    let mut code = String::with_capacity(12);
    for byte in digest.iter().take(12) {
        code.push(UNLOCK_ALPHABET[(*byte as usize) % UNLOCK_ALPHABET.len()] as char);
    }
    unlock_chunks(&code)
}

#[tauri::command]
fn get_unlock_challenge() -> Result<String, String> {
    Ok(unlock_machine_code())
}

#[tauri::command]
fn verify_unlock_code(code: String) -> Result<bool, String> {
    let expected = unlock_expected_code(&unlock_machine_code());
    Ok(unlock_normalize(&code) == unlock_normalize(&expected))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_in_terminal,
            command_exists,
            get_tool_version,
            save_tool_api_config,
            open_in_app_browser,
            call_api,
            list_models,
            read_local_access,
            get_unlock_challenge,
            verify_unlock_code,
            check_endpoint,
            run_diagnostics,
            read_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
