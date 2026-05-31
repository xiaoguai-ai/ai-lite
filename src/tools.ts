// 单一数据源：要新增一个 AI CLI 工具，只需在对应分组里加一条即可。
// install.unix  : macOS / Linux 安装命令
// install.win   : Windows (PowerShell) 安装命令；留空表示暂不支持 Windows 一键安装
// needsNode     : 是否依赖 Node.js / npm
// commands      : 用于判断是否已经安装；第一个命令也是默认打开命令
// launch        : 自定义打开命令；不填则使用 commands[0]
// downloadUrl   : 官网或桌面/CLI 下载页面

export interface Tool {
  id: string;
  name: string;
  desc: string;
  vendor: string;
  commands: string[];
  launch?: { unix: string; win?: string };
  downloadUrl?: string;
  install?: { unix: string; win?: string };
  uninstall?: { unix: string; win?: string };
  needsNode?: boolean;
  localApi?: boolean; // 支持配置本地/自定义 API（启动时注入环境变量）
  // 本地 API 对应的环境变量名；extraKeyVars 里的变量也会写入 API Key 值
  apiEnv?: { key: string; baseUrl: string; model?: string; extraKeyVars?: string[] };
  // 统一启动规格：该 CLI 用哪种协议接入第三方 API，以及如何生成启动命令
  launchSpec?: {
    // openai-chat: chat/completions；openai-responses: Codex 专用 responses；anthropic: Claude
    protocol: "openai-chat" | "openai-responses" | "anthropic";
    build: (baseUrl: string, apiKey: string, model: string, win: boolean) => string;
    buildLocal?: (model: string, baseUrl: string, token: string, win: boolean) => string;
    // 经 codex-relay 代理，将 chat/completions 端点转成 responses 供 Codex 使用
    buildRelay?: (baseUrl: string, apiKey: string, model: string, win: boolean) => string;
  };
}

// 按平台生成「设置环境变量后执行命令」：Windows 用 PowerShell 语法，其它用 bash 内联
export function envCmd(vars: Record<string, string>, cmd: string, win: boolean): string {
  if (win) {
    const sets = Object.entries(vars)
      .map(([k, v]) => `$env:${k}='${v}'`)
      .join("; ");
    return `${sets}; ${cmd}`;
  }
  const inline = Object.entries(vars)
    .map(([k, v]) => `${k}='${v}'`)
    .join(" ");
  return `${inline} ${cmd}`;
}

// 启动端点：本地 API / 固定服务商 / 自定义
export interface LaunchEndpoint {
  id: string;
  name: string;
  kind: "local" | "fixed" | "custom";
  // 该端点支持的协议（用于和 CLI 的 launchSpec.protocol 匹配）
  protocols: ("openai-chat" | "openai-responses" | "anthropic")[];
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  models?: string[];
}

export interface ToolGroup {
  region: string;
  localLanguage: string;
  tools: Tool[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    region: "🇺🇸 美国",
    localLanguage: "English",
    tools: [
      {
        id: "codex",
        name: "Codex CLI",
        desc: "OpenAI 官方终端编程助手",
        vendor: "OpenAI",
        needsNode: true,
        commands: ["codex"],
        downloadUrl: "https://www.npmjs.com/package/@openai/codex",
        install: { unix: "npm install -g @openai/codex", win: "npm install -g @openai/codex" },
        localApi: true,
        apiEnv: { key: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL", model: "OPENAI_MODEL" },
        launchSpec: {
          protocol: "openai-responses",
          build: (baseUrl, apiKey, model, win) => {
            const codex = `codex -m ${model} -c model_provider=ai_lite -c model_providers.ai_lite.name=ai-lite -c "model_providers.ai_lite.base_url=${baseUrl}" -c model_providers.ai_lite.env_key=AI_LITE_KEY -c model_providers.ai_lite.wire_api=responses -c model_providers.ai_lite.requires_openai_auth=false`;
            return envCmd({ AI_LITE_KEY: apiKey }, codex, win);
          },
          buildLocal: (model) => `codex -m ${model} -c model_provider=codex_local_access`,
          buildRelay: (baseUrl, apiKey, model, win) => {
            const codex = `codex -m ${model} -c model_provider=ai_lite -c model_providers.ai_lite.name=ai-lite -c "model_providers.ai_lite.base_url=http://127.0.0.1:4455/v1" -c model_providers.ai_lite.env_key=AI_LITE_KEY -c model_providers.ai_lite.wire_api=responses -c model_providers.ai_lite.requires_openai_auth=false`;
            if (win) {
              return (
                `if (-not (Get-Command codex-relay -ErrorAction SilentlyContinue)) { pip install --user codex-relay }; ` +
                `$env:CODEX_RELAY_UPSTREAM='${baseUrl}'; $env:CODEX_RELAY_API_KEY='${apiKey}'; $env:CODEX_RELAY_PORT='4455'; ` +
                `Start-Process -WindowStyle Hidden codex-relay; Start-Sleep -Seconds 2; ` +
                envCmd({ AI_LITE_KEY: apiKey }, codex, true)
              );
            }
            return (
              `command -v codex-relay >/dev/null 2>&1 || pip install --user codex-relay; ` +
              `CODEX_RELAY_UPSTREAM='${baseUrl}' CODEX_RELAY_API_KEY='${apiKey}' CODEX_RELAY_PORT=4455 codex-relay >/tmp/codex-relay.log 2>&1 & ` +
              `sleep 2; ` +
              envCmd({ AI_LITE_KEY: apiKey }, codex, false)
            );
          },
        },
      },
      {
        id: "claude",
        name: "Claude Code",
        desc: "Anthropic 官方编程助手",
        vendor: "Anthropic",
        needsNode: true,
        commands: ["claude"],
        downloadUrl: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
        install: {
          unix: "npm install -g @anthropic-ai/claude-code",
          win: "npm install -g @anthropic-ai/claude-code",
        },
        localApi: true,
        apiEnv: {
          key: "ANTHROPIC_AUTH_TOKEN",
          baseUrl: "ANTHROPIC_BASE_URL",
          model: "ANTHROPIC_MODEL",
          extraKeyVars: ["ANTHROPIC_API_KEY"],
        },
        launchSpec: {
          protocol: "anthropic",
          build: (baseUrl, apiKey, model, win) =>
            envCmd({ ANTHROPIC_AUTH_TOKEN: apiKey, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_MODEL: model }, "claude", win),
          buildLocal: (model, baseUrl, token, win) =>
            envCmd({ ANTHROPIC_AUTH_TOKEN: token, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_MODEL: model }, "claude", win),
        },
      },
      {
        id: "copilot",
        name: "GitHub Copilot CLI",
        desc: "GitHub 官方终端助手",
        vendor: "GitHub",
        needsNode: true,
        commands: ["copilot", "github-copilot", "gh"],
        downloadUrl: "https://github.com/features/copilot",
        install: { unix: "npm install -g @github/copilot", win: "npm install -g @github/copilot" },
      },
      {
        id: "antigravity",
        name: "Antigravity CLI",
        desc: "Google 官方助手（原 Gemini CLI）",
        vendor: "Google",
        commands: ["antigravity"],
        downloadUrl: "https://antigravity.google/download",
        install: {
          unix: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
          win: "irm https://antigravity.google/cli/install.ps1 | iex",
        },
      },
      {
        id: "kiro",
        name: "Kiro CLI",
        desc: "AWS 出品终端助手",
        vendor: "AWS",
        commands: ["kiro-cli", "kiro"],
        downloadUrl: "https://kiro.dev/",
        install: {
          unix: "curl -fsSL https://cli.kiro.dev/install | bash",
          win: "irm 'https://cli.kiro.dev/install.ps1' | iex",
        },
      },
      {
        id: "cursor",
        name: "Cursor CLI",
        desc: "Cursor 终端 Agent",
        vendor: "Anysphere",
        commands: ["cursor-agent", "cursor"],
        downloadUrl: "https://cursor.com/downloads",
        install: { unix: "curl https://cursor.com/install -fsS | bash" },
      },
      {
        id: "windsurf",
        name: "Windsurf",
        desc: "Codeium/Windsurf AI 编程编辑器",
        vendor: "Codeium",
        commands: ["windsurf"],
        downloadUrl: "https://windsurf.com/editor",
      },
      {
        id: "replit",
        name: "Replit Agent",
        desc: "云端 AI 应用构建工具",
        vendor: "Replit",
        commands: ["replit"],
        downloadUrl: "https://replit.com/ai",
      },
      {
        id: "grok",
        name: "Grok CLI",
        desc: "xAI Grok 终端助手（社区版）",
        vendor: "superagent-ai",
        commands: ["grok"],
        downloadUrl: "https://github.com/superagent-ai/grok-cli",
        install: {
          unix: "curl -fsSL https://raw.githubusercontent.com/superagent-ai/grok-cli/main/install.sh | bash",
        },
      },
      {
        id: "hermes",
        name: "Hermes Agent",
        desc: "NousResearch 自我改进型 AI Agent",
        vendor: "NousResearch",
        commands: ["hermes"],
        downloadUrl: "https://hermes-agent.nousresearch.com/",
        install: {
          unix: "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
          win: "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)",
        },
      },
    ],
  },
  {
    region: "🇨🇳 中国",
    localLanguage: "中文",
    tools: [
      {
        id: "qwen",
        name: "Qwen Code",
        desc: "阿里通义千问编程 CLI",
        vendor: "阿里巴巴",
        needsNode: true,
        commands: ["qwen"],
        downloadUrl: "https://github.com/QwenLM/qwen-code",
        launch: {
          unix: "qwen --auth-type openai --prompt-interactive \"\"",
          win: "qwen --prompt-interactive \"\"",
        },
        localApi: true,
        apiEnv: {
          key: "OPENAI_API_KEY",
          baseUrl: "OPENAI_BASE_URL",
          model: "OPENAI_MODEL",
          extraKeyVars: ["BAILIAN_CODING_PLAN_API_KEY"],
        },
        launchSpec: {
          protocol: "openai-chat",
          build: (baseUrl, apiKey, model, win) =>
            envCmd({ OPENAI_API_KEY: apiKey, OPENAI_BASE_URL: baseUrl, OPENAI_MODEL: model }, `qwen --auth-type openai --prompt-interactive ""`, win),
          buildLocal: (model, baseUrl, token, win) =>
            envCmd({ OPENAI_API_KEY: token, OPENAI_BASE_URL: baseUrl, OPENAI_MODEL: model }, `qwen --auth-type openai --prompt-interactive ""`, win),
        },
        install: {
          unix: "npm install -g @qwen-code/qwen-code@latest",
          win: "npm install -g @qwen-code/qwen-code@latest",
        },
      },
      {
        id: "kimi",
        name: "Kimi Code CLI",
        desc: "月之暗面 Kimi 终端助手",
        vendor: "Moonshot",
        commands: ["kimi"],
        downloadUrl: "https://code.kimi.com/",
        install: {
          unix: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
          win: "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
        },
      },
      {
        id: "codebuddy",
        name: "CodeBuddy Code",
        desc: "腾讯云代码助手终端版",
        vendor: "腾讯",
        needsNode: true,
        commands: ["codebuddy"],
        downloadUrl: "https://cloud.tencent.com/product/codebuddy",
        install: {
          unix: "npm install -g @tencent-ai/codebuddy-code",
          win: "npm install -g @tencent-ai/codebuddy-code",
        },
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        desc: "深度求索模型与 API 平台",
        vendor: "DeepSeek",
        commands: ["deepseek"],
        downloadUrl: "https://platform.deepseek.com/",
      },
      {
        id: "baidu-comate",
        name: "Baidu Comate",
        desc: "百度智能代码助手",
        vendor: "百度",
        commands: ["comate"],
        downloadUrl: "https://comate.baidu.com/",
      },
    ],
  },
  {
    region: "🇫🇷 法国",
    localLanguage: "Français",
    tools: [
      {
        id: "mistral",
        name: "Mistral Vibe",
        desc: "Mistral 开源终端助手",
        vendor: "Mistral",
        commands: ["mistral-vibe", "vibe"],
        downloadUrl: "https://mistral.ai/",
        install: { unix: "curl -LsSf https://mistral.ai/vibe/install.sh | bash" },
      },
    ],
  },
  {
    region: "🇯🇵 日本",
    localLanguage: "日本語",
    tools: [
      {
        id: "sakana",
        name: "Sakana AI",
        desc: "东京 AI 公司，提供日本本土模型与研究工具入口",
        vendor: "Sakana AI",
        commands: ["sakana"],
        downloadUrl: "https://sakana.ai/",
      },
      {
        id: "elyza",
        name: "ELYZA",
        desc: "日本 LLM 与企业 AI 平台",
        vendor: "ELYZA",
        commands: ["elyza"],
        downloadUrl: "https://elyza.ai/",
      },
      {
        id: "rinna",
        name: "rinna",
        desc: "日本生成式 AI 与语言模型服务",
        vendor: "rinna",
        commands: ["rinna"],
        downloadUrl: "https://rinna.co.jp/",
      },
    ],
  },
  {
    region: "🇰🇷 韩国",
    localLanguage: "한국어",
    tools: [
      {
        id: "upstage",
        name: "Upstage Solar",
        desc: "韩国 Upstage 的 Solar 模型与 API 平台",
        vendor: "Upstage",
        commands: ["upstage"],
        downloadUrl: "https://www.upstage.ai/",
      },
      {
        id: "clova-studio",
        name: "CLOVA Studio",
        desc: "NAVER HyperCLOVA X 模型与 no-code/API 平台",
        vendor: "NAVER",
        commands: ["clova"],
        downloadUrl: "https://clovastudio.ncloud.com/",
      },
      {
        id: "hyperclova-x",
        name: "HyperCLOVA X",
        desc: "NAVER 面向韩语和东亚语言优化的大模型",
        vendor: "NAVER",
        commands: ["hyperclova"],
        downloadUrl: "https://clova.ai/en/hyperclova",
      },
    ],
  },
  {
    region: "🇨🇿 捷克",
    localLanguage: "Čeština",
    tools: [
      {
        id: "jetbrains-ai",
        name: "JetBrains AI Assistant",
        desc: "JetBrains IDE 内置 AI 助手与 Junie Agent",
        vendor: "JetBrains",
        commands: ["jetbrains-toolbox", "idea", "webstorm", "pycharm"],
        downloadUrl: "https://www.jetbrains.com/ai/",
      },
    ],
  },
  {
    region: "🇮🇱 以色列",
    localLanguage: "עברית",
    tools: [
      {
        id: "tabnine",
        name: "Tabnine",
        desc: "企业级 AI 代码补全和聊天助手",
        vendor: "Tabnine",
        commands: ["tabnine"],
        downloadUrl: "https://www.tabnine.com/",
      },
    ],
  },
  {
    region: "🌍 开源",
    localLanguage: "Open Source",
    tools: [
      {
        id: "aider",
        name: "Aider",
        desc: "终端里的 AI 结对编程工具",
        vendor: "Aider",
        commands: ["aider"],
        downloadUrl: "https://aider.chat/",
        launchSpec: {
          protocol: "openai-chat",
          build: (baseUrl, apiKey, model, win) =>
            envCmd({ OPENAI_API_BASE: baseUrl, OPENAI_API_KEY: apiKey }, `aider --model openai/${model}`, win),
          buildLocal: (model, baseUrl, token, win) =>
            envCmd({ OPENAI_API_BASE: baseUrl, OPENAI_API_KEY: token }, `aider --model openai/${model}`, win),
        },
        install: {
          unix: "python -m pip install -U aider-chat",
          win: "py -m pip install -U aider-chat",
        },
      },
      {
        id: "tabby",
        name: "Tabby",
        desc: "可自托管的开源 AI 编程助手",
        vendor: "TabbyML",
        commands: ["tabby"],
        downloadUrl: "https://www.tabbyml.com/",
      },
      {
        id: "opencode",
        name: "OpenCode",
        desc: "最流行的开源 AI 编程 CLI",
        vendor: "Anomaly",
        commands: ["opencode"],
        downloadUrl: "https://opencode.ai/",
        install: {
          unix: "curl -fsSL https://opencode.ai/install | bash",
          win: "npm install -g opencode-ai",
        },
      },
      {
        id: "openclaw",
        name: "OpenClaw",
        desc: "开源 AI Agent 自动化框架",
        vendor: "OpenClaw",
        needsNode: true,
        commands: ["openclaw"],
        downloadUrl: "https://github.com/openclaw/openclaw",
        install: {
          unix: "npm install -g openclaw",
          win: "npm install -g openclaw",
        },
      },
    ],
  },
  {
    region: "🧰 专业网站",
    localLanguage: "Web Apps",
    tools: [
      {
        id: "lovart",
        name: "Lovart",
        desc: "AI 设计与创意生成专业网站",
        vendor: "Lovart",
        commands: ["lovart"],
        downloadUrl: "https://www.lovart.ai/",
      },
      {
        id: "chatgpt",
        name: "ChatGPT",
        desc: "通用 AI 助手与图片、文件、代码能力",
        vendor: "OpenAI",
        commands: ["chatgpt"],
        downloadUrl: "https://chatgpt.com/",
      },
      {
        id: "claude-web",
        name: "Claude",
        desc: "长文本、写作、分析和代码助手",
        vendor: "Anthropic",
        commands: ["claude-web"],
        downloadUrl: "https://claude.ai/",
      },
      {
        id: "gemini-web",
        name: "Gemini",
        desc: "Google 多模态 AI 助手",
        vendor: "Google",
        commands: ["gemini-web"],
        downloadUrl: "https://gemini.google.com/",
      },
      {
        id: "perplexity",
        name: "Perplexity",
        desc: "AI 搜索、研究和资料整理",
        vendor: "Perplexity",
        commands: ["perplexity"],
        downloadUrl: "https://www.perplexity.ai/",
      },
      {
        id: "runway",
        name: "Runway",
        desc: "AI 视频生成和创意工作流",
        vendor: "Runway",
        commands: ["runway"],
        downloadUrl: "https://runwayml.com/",
      },
      {
        id: "midjourney",
        name: "Midjourney",
        desc: "AI 图像生成创作平台",
        vendor: "Midjourney",
        commands: ["midjourney"],
        downloadUrl: "https://www.midjourney.com/",
      },
      {
        id: "elevenlabs",
        name: "ElevenLabs",
        desc: "AI 语音生成、配音和音频工具",
        vendor: "ElevenLabs",
        commands: ["elevenlabs"],
        downloadUrl: "https://elevenlabs.io/",
      },
    ],
  },
];

// API 测试预设服务商
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
}

export const PROVIDERS: Provider[] = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "moonshot", name: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { id: "dashscope", name: "阿里百炼 (Qwen)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { id: "custom", name: "自定义", baseUrl: "", model: "" },
];

// 百炼启动时的建议模型列表
export const BAILIAN_MODELS: string[] = [
  "qwen3-coder-plus",
  "qwen3-coder-flash",
  "qwen3-max",
  "qwen-plus",
  "qwen-max",
  "qwen-flash",
];

// 统一「启动」菜单的端点：本地 API / 百炼 / DeepSeek / 其它模型 / 中转站
export const LAUNCH_ENDPOINTS: LaunchEndpoint[] = [
  { id: "local", name: "本地 API（Codex Lite）", kind: "local", protocols: ["openai-responses", "openai-chat", "anthropic"] },
  {
    id: "bailian",
    name: "阿里百炼 Coding Plan",
    kind: "fixed",
    protocols: ["openai-chat", "anthropic"],
    openaiBaseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    anthropicBaseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    models: ["qwen3.6-plus", "qwen3.5-plus", "qwen3-max-2026-01-23", "qwen3-coder-next", "qwen3-coder-plus", "glm-5", "glm-4.7", "kimi-k2.5", "MiniMax-M2.5"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "fixed",
    protocols: ["openai-chat", "anthropic"],
    openaiBaseUrl: "https://api.deepseek.com",
    anthropicBaseUrl: "https://api.deepseek.com/anthropic",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
  },
  {
    id: "other",
    name: "其它模型（OpenAI 兼容）",
    kind: "custom",
    protocols: ["openai-chat", "anthropic"],
    models: [],
  },
  {
    id: "relay",
    name: "中转站",
    kind: "custom",
    protocols: ["openai-chat", "anthropic"],
    models: [],
  },
];
