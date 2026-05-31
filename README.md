# AI Lite

一个轻量的桌面工具，集中管理各家 AI 编程 CLI：一键安装、配置端点启动、测试 API、管理 Key。基于 Tauri 2 + React 19 + TypeScript。

---

## 功能

### 安装中心
- 按地区分组列出各家 AI CLI（Codex、Claude Code、Qwen、Kimi、CodeBuddy、Aider、OpenCode、Hermes、OpenClaw 等）。
- 自动检测是否已安装，显示版本号。
- 一键安装 / 卸载 / 打开 / 在内置窗口浏览官网。
- 搜索框按名称/描述/厂商过滤；星标可把常用工具置顶。
- 「刷新全部」重新检测所有工具状态。

### 启动（多端点）
已安装且支持的 CLI 卡片上有「启动 ▾」，可选择端点后选模型启动：

| 端点 | 说明 |
| --- | --- |
| 本地 API（Codex Lite） | 读取本机 Codex Lite 的本地 API，自动拉取模型列表 |
| 阿里百炼 Coding Plan | 内置 OpenAI / Anthropic 端点与模型白名单 |
| DeepSeek | 内置端点，模型 deepseek-v4-pro / deepseek-v4-flash |
| 其它模型（OpenAI 兼容） | 自填 Base URL + Key + 模型 |
| 中转站 | 自填地址，可收藏复用 |

- 按 CLI 协议自动匹配端点：Qwen/Aider 走 OpenAI Chat，Claude 走 Anthropic，Codex 走 Responses。
- **Codex 接 chat 端点**通过 [codex-relay](https://pypi.org/project/codex-relay/) 自动代理转换（首次会自动 `pip install`）。
- 记住每个 CLI 上次的端点/模型/Key；可「检测连通性」；中转站可收藏。

### API 测试
- 预设 OpenAI / DeepSeek / Moonshot / 阿里百炼，或自定义。
- 测试成功后可命名保存到 Key 管理。

### Key 管理
- 集中管理保存的 Key，按服务商分组。
- 每条可：测试有效性、重命名、查看/复制、删除。
- 仅保存在本机（localStorage）。

### 其它
- **启动历史**：记录每次启动的时间/工具/端点/模型。
- **体检**：检查 Node / npm / Python / pip / codex-relay / 本地 API 状态，并查看后台日志。
- **深色模式** 与 **中文 / English** 切换（右上角）。
- **解锁门**：首次进入需输入验证码（机器码 + 验证码机制）。

---

## 开发

需要 Node.js 18+ 与 Rust（含 Tauri 2 依赖）。

```bash
npm install
npm run tauri dev      # 开发模式（热更新）
```

常用脚本：
- `npm run dev` — 仅前端 dev server
- `npm run typecheck` — TypeScript 类型检查
- `npm run build` — 前端构建

---

## 构建

### Linux / macOS

```bash
npm install
npx tauri build              # 生成安装包
npx tauri build --no-bundle  # 仅生成可执行文件
```

产物位于 `src-tauri/target/release/`。

### Windows（生成 .exe / .msi）

Windows 兼容已在代码层完成（启动命令按平台用 PowerShell 语法、路径用系统临时目录）。需在 **Windows 机器** 上构建：

1. 安装依赖：
   - [Node.js 18+](https://nodejs.org/)
   - [Rust](https://rustup.rs/)
   - Microsoft C++ Build Tools（Visual Studio 生成工具）
   - WebView2 运行时（Win10/11 一般已自带）
2. 构建：
   ```powershell
   npm install
   npx tauri build
   ```
3. 产物：
   - 可执行文件：`src-tauri\target\release\ai-lite.exe`
   - 安装包（.msi / .exe）：`src-tauri\target\release\bundle\`

> 注：本项目在 Linux 上无法交叉编译出 Windows 二进制，需在 Windows 本机或 CI 上构建。

---

## 平台说明

- **启动命令**：Windows 用 PowerShell（`$env:VAR='x'; cmd`），Linux/macOS 用 bash 内联（`VAR=x cmd`），自动适配。
- **codex-relay**：Windows 用 `Start-Process` 后台运行，类 Unix 用 `&`。
- **本地 API（Codex Lite）启动**：依赖本机已安装并开启 Codex Lite 的本地 API；其配置路径为 `~/.antigravity_cockpit/codex_local_access.json`。
- **百炼 Coding Plan**：仅限在编程工具内使用，不能直接 API 调用；Codex 因协议限制不支持该端点。

---

## 验证码解锁

首次进入需输入验证码：
1. 应用显示「机器码」。
2. 用配套解码器（与 Codex Lite 共用同一盐）输入机器码生成「验证码」。
3. 填入验证码进入。已解锁的机器下次会自动回填验证码。
