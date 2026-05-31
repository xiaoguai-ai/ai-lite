import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TOOL_GROUPS, PROVIDERS, LAUNCH_ENDPOINTS, type Tool, type LaunchEndpoint } from "./tools";
import qrcode from "./assets/qrcode.png";
import { LangContext, useT, makeT, type Lang } from "./i18n";
import "./App.css";

type Tab = "install" | "api" | "keys" | "history" | "diagnostics";
type InstallState = "checking" | "installed" | "missing";

interface SavedConfig {
  id: string;
  providerId: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  savedAt: number;
  label?: string;
}

const SAVED_KEY = "ai-lite:saved-api-configs";

function loadSavedConfigs(): SavedConfig[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedConfig[]) : [];
  } catch {
    return [];
  }
}

function persistSavedConfigs(list: SavedConfig[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// 记住每个 CLI 上次的启动配置（端点 + 模型 + Base URL + Key）
interface LastLaunch {
  endpointId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}
const LAST_LAUNCH_KEY = "ai-lite:last-launch";
function loadLastLaunch(): Record<string, LastLaunch> {
  try {
    return JSON.parse(localStorage.getItem(LAST_LAUNCH_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveLastLaunch(toolId: string, v: LastLaunch) {
  try {
    const all = loadLastLaunch();
    all[toolId] = v;
    localStorage.setItem(LAST_LAUNCH_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// 中转站收藏（自定义 Base URL + 模型）
interface RelayFav {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}
const RELAY_FAV_KEY = "ai-lite:relay-favorites";
function loadRelayFavs(): RelayFav[] {
  try {
    return JSON.parse(localStorage.getItem(RELAY_FAV_KEY) || "[]");
  } catch {
    return [];
  }
}
function persistRelayFavs(list: RelayFav[]) {
  try {
    localStorage.setItem(RELAY_FAV_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// 启动历史
interface LaunchHistoryItem {
  at: number;
  tool: string;
  endpoint: string;
  model: string;
}
const HISTORY_KEY = "ai-lite:launch-history";
function loadHistory(): LaunchHistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function addHistory(item: LaunchHistoryItem) {
  try {
    const next = [item, ...loadHistory()].slice(0, 100);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// 当前系统：Tauri 在 navigator.userAgent 暴露平台信息
const IS_WINDOWS = navigator.userAgent.includes("Windows");

const NODE_INSTALL_COMMAND = IS_WINDOWS
  ? "winget install OpenJS.NodeJS.LTS"
  : "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs";
const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";

function installCommand(tool: Tool): string {
  if (!tool.install) {
    return "";
  }
  return IS_WINDOWS ? tool.install.win ?? "" : tool.install.unix;
}

function openCommand(tool: Tool): string {
  if (tool.launch) {
    return IS_WINDOWS ? tool.launch.win ?? "" : tool.launch.unix;
  }
  return tool.commands[0] ?? "";
}

// 卸载命令：显式 uninstall 优先；否则从 `npm install -g <pkg>` 自动推导
function uninstallCommand(tool: Tool): string {
  if (tool.uninstall) {
    return IS_WINDOWS ? tool.uninstall.win ?? "" : tool.uninstall.unix;
  }
  const installCmd = IS_WINDOWS ? tool.install?.win ?? "" : tool.install?.unix ?? "";
  const m = installCmd.match(/npm install -g (\S+)/);
  if (m) {
    const pkg = m[1].replace(/@latest$/, "");
    return `npm uninstall -g ${pkg}`;
  }
  return "";
}

function InstallCenter() {
  const tr = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("ai-lite:fav-tools") || "[]"); } catch { return []; }
  });
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TOOL_GROUPS.map((group) => [group.region, false])),
  );
  const [launchTool, setLaunchTool] = useState<Tool | null>(null);
  const [savedKeys, setSavedKeys] = useState<SavedConfig[]>([]);
  const [launchEndpoint, setLaunchEndpoint] = useState<LaunchEndpoint | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [launchModel, setLaunchModel] = useState("");
  const [launchKey, setLaunchKey] = useState("");
  const [launchBaseUrl, setLaunchBaseUrl] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [access, setAccess] = useState<{ baseUrl: string; token: string }>({ baseUrl: "", token: "" });
  const [relayFavs, setRelayFavs] = useState<RelayFav[]>([]);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const launchPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (launchTool && launchEndpoint) {
      launchPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [launchTool, launchEndpoint]);

  const refreshTool = async (tool: Tool) => {
    setInstallStates((prev) => ({ ...prev, [tool.id]: "checking" }));
    try {
      const installed = await invoke<boolean>("command_exists", { commands: tool.commands });
      setInstallStates((prev) => ({ ...prev, [tool.id]: installed ? "installed" : "missing" }));
      if (installed) {
        invoke<string>("get_tool_version", { command: tool.commands[0] })
          .then((v) => setVersions((p) => ({ ...p, [tool.id]: v })))
          .catch(() => {});
      }
    } catch {
      setInstallStates((prev) => ({ ...prev, [tool.id]: "missing" }));
    }
  };

  const refreshAll = () => {
    for (const group of TOOL_GROUPS) for (const tool of group.tools) void refreshTool(tool);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem("ai-lite:fav-tools", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    for (const group of TOOL_GROUPS) {
      for (const tool of group.tools) {
        void refreshTool(tool);
      }
    }
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
        if (!d.contains(target)) d.removeAttribute("open");
      });
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const install = async (tool: Tool) => {
    if (installStates[tool.id] === "installed") {
      setStatus({ ok: false, msg: `${tool.name} 已安装，不能重复安装` });
      return;
    }
    const command = installCommand(tool);
    if (!command) {
      setStatus({ ok: false, msg: `${tool.name} 暂不支持当前系统的一键安装，请参考官网` });
      return;
    }
    setBusy(tool.id);
    setStatus(null);
    try {
      await invoke<string>("run_in_terminal", { command, toolId: tool.id });
      setStatus({ ok: true, msg: `已在终端开始安装 ${tool.name}` });
      window.setTimeout(() => void refreshTool(tool), 3000);
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (tool: Tool) => {
    const command = uninstallCommand(tool);
    if (!command) {
      setStatus({ ok: false, msg: `${tool.name} 暂不支持一键卸载，请手动卸载` });
      return;
    }
    if (!window.confirm(`确定卸载 ${tool.name} 吗？将执行：\n${command}`)) return;
    setBusy(tool.id);
    setStatus(null);
    try {
      await invoke<string>("run_in_terminal", { command, toolId: tool.id });
      setStatus({ ok: true, msg: `已在终端开始卸载 ${tool.name}` });
      window.setTimeout(() => void refreshTool(tool), 3000);
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const installNode = async () => {
    setBusy("node");
    setStatus(null);
    try {
      await invoke<string>("run_in_terminal", { command: NODE_INSTALL_COMMAND });
      setStatus({ ok: true, msg: "已在终端开始安装 Node.js LTS" });
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const openDownload = async (url: string, label: string) => {
    setStatus(null);
    try {
      await openUrl(url);
    } catch (e) {
      setStatus({ ok: false, msg: `打开 ${label} 下载页失败：${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const browseInside = async (url: string, label: string) => {
    setStatus(null);
    try {
      await invoke<void>("open_in_app_browser", { url, title: label });
    } catch (e) {
      setStatus({
        ok: false,
        msg: `内置窗口打开 ${label} 失败：${e instanceof Error ? e.message : String(e)}。可以试试“下载”按钮用外部浏览器打开。`,
      });
    }
  };

  const open = async (tool: Tool) => {
    const command = openCommand(tool);
    if (!command) {
      setStatus({ ok: false, msg: `${tool.name} 没有可打开的命令` });
      return;
    }
    setBusy(tool.id);
    setStatus(null);
    try {
      await invoke<string>("run_in_terminal", { command, toolId: tool.id });
      setStatus({ ok: true, msg: `已打开 ${tool.name}` });
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  // 打开「启动」面板：选择某个端点
  const chooseEndpoint = async (tool: Tool, endpoint: LaunchEndpoint) => {
    setLaunchTool(tool);
    setLaunchEndpoint(endpoint);
    setSavedKeys(loadSavedConfigs());
    setRelayFavs(loadRelayFavs());
    setCheckResult(null);
    setModels(endpoint.models ?? []);
    setLaunchModel(endpoint.models?.[0] ?? "");
    setLaunchKey("");
    // 固定端点按当前 CLI 协议预填 Base URL，供查看/微调
    const proto = tool.launchSpec?.protocol ?? "openai-chat";
    const presetBase = endpoint.kind === "fixed"
      ? (proto === "anthropic" ? endpoint.anthropicBaseUrl ?? "" : endpoint.openaiBaseUrl ?? "")
      : "";
    setLaunchBaseUrl(presetBase);
    setStatus(null);
    // 恢复该 CLI 上次在此端点的配置
    const last = loadLastLaunch()[tool.id];
    if (last && last.endpointId === endpoint.id) {
      if (last.model) setLaunchModel(last.model);
      if (last.baseUrl) setLaunchBaseUrl(last.baseUrl);
      if (last.apiKey) setLaunchKey(last.apiKey);
    }
    if (endpoint.kind === "local") {
      setModelsLoading(true);
      try {
        const acc = await invoke<{ enabled: boolean; baseUrl: string; token: string }>("read_local_access");
        if (!acc.enabled) {
          setStatus({ ok: false, msg: "本地 API 未启用，请先在 Codex Lite 中开启本地 API 服务" });
          setLaunchTool(null);
          return;
        }
        setAccess({ baseUrl: acc.baseUrl, token: acc.token });
        const list = await invoke<string[]>("list_models", { baseUrl: acc.baseUrl, apiKey: acc.token });
        setModels(list);
        setLaunchModel((prev) => (prev && list.includes(prev) ? prev : list[0] ?? ""));
      } catch (e) {
        setStatus({ ok: false, msg: `读取本地模型失败：${e instanceof Error ? e.message : String(e)}` });
        setLaunchTool(null);
      } finally {
        setModelsLoading(false);
      }
    }
  };

  const startLaunch = async () => {
    const tool = launchTool;
    const ep = launchEndpoint;
    const spec = tool?.launchSpec;
    if (!tool || !ep || !spec || !launchModel) return;
    let command = "";
    if (ep.kind === "local") {
      if (!spec.buildLocal) {
        setStatus({ ok: false, msg: `${tool.name} 不支持本地 API 启动` });
        return;
      }
      command = spec.buildLocal(launchModel, access.baseUrl, access.token, IS_WINDOWS);
    } else {
      const baseUrl = launchBaseUrl.trim();
      if (!baseUrl) {
        setStatus({ ok: false, msg: "请填写 Base URL" });
        return;
      }
      if (!launchKey) {
        setStatus({ ok: false, msg: "请填写 API Key" });
        return;
      }
      const native = ep.protocols.includes(spec.protocol);
      if (native) {
        command = spec.build(baseUrl, launchKey, launchModel, IS_WINDOWS);
      } else if (spec.buildRelay && ep.protocols.includes("openai-chat")) {
        command = spec.buildRelay(baseUrl, launchKey, launchModel, IS_WINDOWS);
      } else {
        setStatus({ ok: false, msg: `${tool.name} 不支持该端点的协议` });
        return;
      }
    }
    setBusy("launch");
    setStatus(null);
    try {
      await invoke<string>("run_in_terminal", { command, toolId: tool.id });
      saveLastLaunch(tool.id, {
        endpointId: ep.id,
        model: launchModel,
        baseUrl: ep.kind === "local" ? "" : launchBaseUrl.trim(),
        apiKey: ep.kind === "local" ? "" : launchKey,
      });
      addHistory({ at: Date.now(), tool: tool.name, endpoint: ep.name, model: launchModel });
      setLaunchTool(null);
      setLaunchKey("");
      setStatus({ ok: true, msg: `已通过「${ep.name}」启动 ${tool.name}（模型：${launchModel}）` });
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const checkEndpoint = async () => {
    const baseUrl = launchEndpoint?.kind === "local" ? access.baseUrl : launchBaseUrl.trim();
    const key = launchEndpoint?.kind === "local" ? access.token : launchKey;
    if (!baseUrl) {
      setCheckResult({ ok: false, msg: "请先填写 Base URL" });
      return;
    }
    setCheckResult({ ok: true, msg: "检测中…" });
    try {
      const msg = await invoke<string>("check_endpoint", { baseUrl, apiKey: key });
      setCheckResult({ ok: true, msg });
    } catch (e) {
      setCheckResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveRelayFav = () => {
    const url = launchBaseUrl.trim();
    if (!url) return;
    const name = window.prompt("给这个中转站起个名字：", url);
    if (!name) return;
    const fav: RelayFav = {
      id: `${Date.now()}`,
      name: name.trim(),
      baseUrl: url,
      models: launchModel ? [launchModel] : [],
    };
    const next = [fav, ...relayFavs.filter((f) => f.baseUrl !== url)].slice(0, 20);
    setRelayFavs(next);
    persistRelayFavs(next);
    setStatus({ ok: true, msg: `已收藏中转站「${name}」` });
  };

  const applyRelayFav = (f: RelayFav) => {
    setLaunchBaseUrl(f.baseUrl);
    if (f.models.length > 0) {
      setModels(f.models);
      setLaunchModel(f.models[0]);
    }
    setCheckResult(null);
  };

  const removeRelayFav = (id: string) => {
    const next = relayFavs.filter((f) => f.id !== id);
    setRelayFavs(next);
    persistRelayFavs(next);
  };

  const renderCard = (t: Tool) => {
    const installable = Boolean(installCommand(t));
    const unsupported = !installable;
    const state = installStates[t.id] ?? "checking";
    const installed = state === "installed";
    const checking = state === "checking";
    const fav = favorites.includes(t.id);
    return (
      <div key={t.id} className="card">
        <div className="card-info">
          <strong>
            <button className={`star ${fav ? "on" : ""}`} title={fav ? "取消置顶" : "置顶"} onClick={() => toggleFavorite(t.id)}>
              {fav ? "★" : "☆"}
            </button>
            {t.name}
          </strong>
          <span>{t.desc}</span>
          <div className="tags">
            <em className="tag vendor">{t.vendor}</em>
            {t.needsNode && <em className="tag">{tr("needNode")}</em>}
            {t.downloadUrl && <em className="tag download">{tr("hasDownload")}</em>}
            {checking && <em className="tag">{tr("checking")}</em>}
            {installed && <em className="tag installed">{tr("installed")}</em>}
            {installed && versions[t.id] && <em className="tag">{versions[t.id]}</em>}
            {unsupported && !installed && <em className="tag warn">{tr("onlyDownload")}</em>}
          </div>
        </div>
        <div className="card-actions">
          {t.launchSpec && installed && (
            <details className="menu">
              <summary>{tr("launch")}</summary>
              <div className="menu-list">
                {LAUNCH_ENDPOINTS.filter((ep) => {
                  const spec = t.launchSpec!;
                  const native = ep.protocols.includes(spec.protocol);
                  const viaRelay = !!spec.buildRelay && ep.protocols.includes("openai-chat");
                  if (ep.kind === "local" && !spec.buildLocal) return false;
                  // 百炼 Coding Plan 不支持新版 Codex 的 responses，经 relay 也会被拒，故对 responses 工具隐藏
                  if (ep.id === "bailian" && spec.protocol === "openai-responses") return false;
                  return native || viaRelay;
                }).map((ep) => (
                  <button key={ep.id} disabled={busy !== null} onClick={() => void chooseEndpoint(t, ep)}>
                    {ep.name}
                  </button>
                ))}
              </div>
            </details>
          )}
          <details className="menu">
            <summary>{tr("menu")}</summary>
            <div className="menu-list">
              {!installed && (
                <button disabled={busy !== null || unsupported || checking} onClick={() => void install(t)}>
                  {busy === t.id ? tr("installing") : checking ? tr("checking") : tr("install")}
                </button>
              )}
              {installed && (
                <button disabled={busy !== null} onClick={() => void open(t)}>
                  {busy === t.id ? tr("opening") : tr("open")}
                </button>
              )}
              {installed && uninstallCommand(t) && (
                <button className="danger" disabled={busy !== null} onClick={() => void uninstall(t)}>
                  {tr("uninstall")}
                </button>
              )}
              {t.downloadUrl && (
                <button disabled={busy !== null} onClick={() => void browseInside(t.downloadUrl!, t.name)}>
                  {tr("innerWindow")}
                </button>
              )}
              {t.downloadUrl && (
                <button disabled={busy !== null} onClick={() => void openDownload(t.downloadUrl!, t.name)}>
                  {tr("download")}
                </button>
              )}
            </div>
          </details>
        </div>
      </div>
    );
  };

  const q = search.trim().toLowerCase();
  const matchTool = (t: Tool) =>
    !q || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.vendor.toLowerCase().includes(q);
  const favTools = TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => favorites.includes(t.id) && matchTool(t));

  return (
    <div className="page">
      <p className="hint">{tr("installHint")}</p>
      <div className="quick-card">
        <div>
          <strong>{tr("nodeTitle")}</strong>
          <span>{tr("nodeDesc")}</span>
        </div>
        <div className="card-actions">
          <button className="secondary-button" disabled={busy !== null} onClick={() => void openDownload(NODE_DOWNLOAD_URL, "Node.js")}>
            {tr("download")}
          </button>
          <button disabled={busy !== null} onClick={() => void installNode()}>
            {busy === "node" ? tr("installing") : tr("installNode")}
          </button>
        </div>
      </div>
      <div className="toolbar">
        <input
          className="search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr("searchPlaceholder")}
        />
        <button className="secondary-button" onClick={refreshAll}>{tr("refreshAll")}</button>
      </div>
      {favTools.length > 0 && (
        <div className="group">
          <div className="group-title" style={{ cursor: "default" }}>
            {tr("pinned")}<em>{favTools.length}</em>
          </div>
          <div className="cards">{favTools.map(renderCard)}</div>
        </div>
      )}
      {TOOL_GROUPS.map((group) => (
        <div key={group.region} className="group">
          <button
            className="group-title"
            onClick={() => setOpenGroups((prev) => ({ ...prev, [group.region]: !prev[group.region] }))}
          >
            <span>{openGroups[group.region] ? "▾" : "▸"}</span>
            {group.region}
            <strong>{group.localLanguage}</strong>
            <em>{group.tools.length}</em>
          </button>
          {(q ? true : openGroups[group.region]) && (
            <div className="cards">
              {group.tools.filter(matchTool).map(renderCard)}
            </div>
          )}
        </div>
      ))}
      {launchTool && launchEndpoint && (
        <div className="config-panel" ref={launchPanelRef}>
          <div className="config-panel-head">
            <strong>{launchTool.name} · {tr("start")}（{launchEndpoint.name}）</strong>
            <button className="secondary-button" disabled={busy !== null} onClick={() => setLaunchTool(null)}>
              {tr("close")}
            </button>
          </div>
          <div className="form">
            {launchEndpoint.kind === "custom" && relayFavs.length > 0 && (
              <label>
                {tr("savedRelays")}
                <div className="saved-bar">
                  {relayFavs.map((f) => (
                    <span key={f.id} className="chip" title={f.baseUrl}>
                      <button type="button" className="chip-main" onClick={() => applyRelayFav(f)}>{f.name}</button>
                      <button type="button" className="chip-del" onClick={() => removeRelayFav(f.id)} title={tr("remove")}>×</button>
                    </span>
                  ))}
                </div>
              </label>
            )}
            {launchEndpoint.kind !== "local" && (
              <label>
                {tr("baseUrl")}
                <input
                  value={launchBaseUrl}
                  onChange={(e) => setLaunchBaseUrl(e.target.value)}
                  placeholder="https://xxx/v1"
                />
              </label>
            )}
            {launchEndpoint.kind !== "local" && (
              <label>
                {tr("apiKey")}
                {savedKeys.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const k = savedKeys.find((s) => s.id === e.target.value);
                      if (k) setLaunchKey(k.apiKey);
                    }}
                  >
                    <option value="">{tr("selectFromKeys")}</option>
                    {savedKeys.map((s) => (
                      <option key={s.id} value={s.id}>
                        {(PROVIDERS.find((p) => p.id === s.providerId)?.name ?? "自定义")} · {s.model || "默认"} · {maskKey(s.apiKey)}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="password"
                  value={launchKey}
                  onChange={(e) => setLaunchKey(e.target.value)}
                  placeholder="sk-..."
                />
              </label>
            )}
            <label>
              {tr("model")}
              {models.length > 0 ? (
                <select value={launchModel} onChange={(e) => setLaunchModel(e.target.value)} disabled={modelsLoading}>
                  {modelsLoading && <option>…</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : launchEndpoint.kind === "local" ? (
                <select disabled>
                  <option>{modelsLoading ? "…" : "—"}</option>
                </select>
              ) : (
                <input value={launchModel} onChange={(e) => setLaunchModel(e.target.value)} placeholder="输入模型名" />
              )}
            </label>
            <div className="launch-actions">
              <button disabled={busy !== null || modelsLoading || !launchModel} onClick={() => void startLaunch()}>
                {busy === "launch" ? tr("starting") : tr("start")}
              </button>
              <button type="button" className="secondary-button" onClick={() => void checkEndpoint()}>
                {tr("checkConn")}
              </button>
              {launchEndpoint.kind === "custom" && (
                <button type="button" className="secondary-button" disabled={!launchBaseUrl.trim()} onClick={saveRelayFav}>
                  {tr("favRelay")}
                </button>
              )}
            </div>
            {checkResult && (
              <div className={`status ${checkResult.ok ? "ok" : "err"}`}>{checkResult.msg}</div>
            )}
          </div>
        </div>
      )}
      {status && <div className={`status ${status.ok ? "ok" : "err"}`}>{status.msg}</div>}
    </div>
  );
}

function ApiTester() {
  const [providerId, setProviderId] = useState(PROVIDERS[0].id);
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].baseUrl);
  const [model, setModel] = useState(PROVIDERS[0].model);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("你好，用一句话介绍你自己");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedConfig[]>(() => loadSavedConfigs());

  const onProviderChange = (id: string) => {
    setProviderId(id);
    const p = PROVIDERS.find((x) => x.id === id)!;
    setBaseUrl(p.baseUrl);
    setModel(p.model);
  };

  const send = async () => {
    setLoading(true);
    setReply("");
    setError("");
    try {
      const res = await invoke<{ content: string }>("call_api", { baseUrl, apiKey, model, message });
      setReply(res.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveCurrent = () => {
    const label = window.prompt("给这个 Key 起个备注名（可留空）：", "") ?? "";
    const item: SavedConfig = { id: `${Date.now()}`, providerId, baseUrl, model, apiKey, savedAt: Date.now(), label: label.trim() || undefined };
    const next = [item, ...saved.filter((s) => !(s.baseUrl === baseUrl && s.model === model))].slice(0, 12);
    setSaved(next);
    persistSavedConfigs(next);
  };

  const alreadySaved = saved.some((s) => s.baseUrl === baseUrl && s.model === model && s.apiKey === apiKey);
  const tr = useT();

  return (
    <div className="page">
      <div className="form">
        <label>
          {tr("provider")}
          <select value={providerId} onChange={(e) => onProviderChange(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          {tr("baseUrl")}
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </label>
        <label>
          {tr("model")}
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
        </label>
        <label>
          {tr("apiKey")}
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
        </label>
        <label>
          {tr("message")}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
        </label>
        <button disabled={loading || !apiKey || !baseUrl || !model} onClick={() => void send()}>
          {loading ? tr("sending") : tr("send")}
        </button>
      </div>
      {error && <div className="status err">{error}</div>}
      {reply && (
        <>
          <div className="reply">{reply}</div>
          <button
            className="secondary-button save-tag"
            disabled={alreadySaved}
            onClick={saveCurrent}
          >
            {alreadySaved ? tr("alreadySaved") : tr("saveThisConfig")}
          </button>
        </>
      )}
    </div>
  );
}

function maskKey(key: string): string {
  if (key.length <= 10) return key.slice(0, 2) + "****";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function KeyManager() {
  const [items, setItems] = useState<SavedConfig[]>(() => loadSavedConfigs());
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const reload = () => setItems(loadSavedConfigs());

  const remove = (s: SavedConfig) => {
    const name = s.label || (PROVIDERS.find((p) => p.id === s.providerId)?.name ?? "自定义");
    const input = window.prompt(`删除确认：请输入该配置的名称「${name}」以删除：`);
    if (input === null) return;
    if (input.trim() !== name) {
      window.alert(`名称不匹配，未删除。需要输入：${name}`);
      return;
    }
    const next = items.filter((x) => x.id !== s.id);
    setItems(next);
    persistSavedConfigs(next);
  };

  const rename = (s: SavedConfig) => {
    const label = window.prompt("修改备注名：", s.label ?? "");
    if (label === null) return;
    const next = items.map((x) => (x.id === s.id ? { ...x, label: label.trim() || undefined } : x));
    setItems(next);
    persistSavedConfigs(next);
  };

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const test = async (s: SavedConfig) => {
    setTesting(s.id);
    setTestResult((p) => ({ ...p, [s.id]: { ok: true, msg: "测试中…" } }));
    try {
      await invoke<{ content: string }>("call_api", {
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        model: s.model || "gpt-4o-mini",
        message: "ping",
      });
      setTestResult((p) => ({ ...p, [s.id]: { ok: true, msg: "✓ 有效" } }));
    } catch (e) {
      setTestResult((p) => ({ ...p, [s.id]: { ok: false, msg: `✗ ${e instanceof Error ? e.message : String(e)}` } }));
    } finally {
      setTesting(null);
    }
  };

  // 按服务商分组
  const groups = items.reduce<Record<string, SavedConfig[]>>((acc, s) => {
    const name = PROVIDERS.find((p) => p.id === s.providerId)?.name ?? "自定义";
    (acc[name] ||= []).push(s);
    return acc;
  }, {});
  const tr = useT();

  return (
    <div className="page">
      <p className="hint">{tr("keysHint")}</p>
      <div className="card-actions" style={{ justifyContent: "flex-end" }}>
        <button className="secondary-button" onClick={reload}>{tr("refresh")}</button>
      </div>
      {items.length === 0 ? (
        <div className="status">{tr("noKeys")}</div>
      ) : (
        Object.entries(groups).map(([groupName, list]) => (
          <div key={groupName} className="group">
            <div className="group-title" style={{ cursor: "default" }}>
              {groupName}
              <em>{list.length}</em>
            </div>
            <div className="cards">
              {list.map((s) => {
                const r = testResult[s.id];
                return (
                  <div key={s.id} className="card">
                    <div className="card-info">
                      <strong>{s.label || `${groupName} · ${s.model || "默认模型"}`}</strong>
                      <span>{s.baseUrl} · {s.model || "默认模型"}</span>
                      <div className="tags">
                        <em className="tag vendor">{revealed[s.id] ? s.apiKey : maskKey(s.apiKey)}</em>
                        <em className="tag">{new Date(s.savedAt || Number(s.id)).toLocaleString()}</em>
                        {r && <em className={`tag ${r.ok ? "installed" : "warn"}`}>{r.msg}</em>}
                      </div>
                    </div>
                    <div className="card-actions">
                      <details className="menu">
                        <summary>{tr("menu")}</summary>
                        <div className="menu-list">
                          <button disabled={testing !== null} onClick={() => void test(s)}>
                            {testing === s.id ? tr("testing") : tr("testValidity")}
                          </button>
                          <button onClick={() => rename(s)}>{tr("rename")}</button>
                          <button onClick={() => setRevealed((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                            {revealed[s.id] ? tr("hideKey") : tr("viewKey")}
                          </button>
                          <button onClick={() => void copy(s.id, s.apiKey)}>
                            {copied === s.id ? tr("copied") : tr("copyKey")}
                          </button>
                          <button className="danger" onClick={() => remove(s)}>{tr("remove")}</button>
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function HistoryPage() {
  const [items, setItems] = useState<LaunchHistoryItem[]>(() => loadHistory());
  const tr = useT();
  const clear = () => {
    localStorage.removeItem(HISTORY_KEY);
    setItems([]);
  };
  return (
    <div className="page">
      <p className="hint">{tr("historyHint")}</p>
      <div className="card-actions" style={{ justifyContent: "flex-end" }}>
        <button className="secondary-button" onClick={() => setItems(loadHistory())}>{tr("refresh")}</button>
        <button className="secondary-button" disabled={items.length === 0} onClick={clear}>{tr("clear")}</button>
      </div>
      {items.length === 0 ? (
        <div className="status">{tr("noHistory")}</div>
      ) : (
        <div className="cards">
          {items.map((h, i) => (
            <div key={i} className="card">
              <div className="card-info">
                <strong>{h.tool} · {h.model}</strong>
                <span>端点：{h.endpoint}</span>
                <div className="tags">
                  <em className="tag">{new Date(h.at).toLocaleString()}</em>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticsPage() {
  const [rows, setRows] = useState<[string, boolean, string][]>([]);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState("");
  const [logName, setLogName] = useState<"relay" | "app">("relay");

  const run = async () => {
    setLoading(true);
    try {
      setRows(await invoke<[string, boolean, string][]>("run_diagnostics"));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const loadLog = async (name: "relay" | "app") => {
    setLogName(name);
    try {
      setLog(await invoke<string>("read_log", { name }));
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void run();
    void loadLog("relay");
  }, []);

  const tr = useT();

  return (
    <div className="page">
      <p className="hint">{tr("diagHint")}</p>
      <div className="card-actions" style={{ justifyContent: "flex-end" }}>
        <button className="secondary-button" disabled={loading} onClick={() => void run()}>
          {loading ? tr("checking") : tr("recheck")}
        </button>
      </div>
      <div className="cards">
        {rows.map(([label, ok, detail]) => (
          <div key={label} className="card">
            <div className="card-info">
              <strong>{label}</strong>
              <span>{detail}</span>
            </div>
            <div className="card-actions">
              <em className={`tag ${ok ? "installed" : "warn"}`}>{ok ? tr("normal") : tr("missing")}</em>
            </div>
          </div>
        ))}
      </div>
      <div className="config-panel">
        <div className="config-panel-head">
          <strong>{tr("logView")}</strong>
          <div className="card-actions">
            <button className={logName === "relay" ? "" : "secondary-button"} onClick={() => void loadLog("relay")}>relay</button>
            <button className={logName === "app" ? "" : "secondary-button"} onClick={() => void loadLog("app")}>app</button>
          </div>
        </div>
        <pre className="log-view">{log || "—"}</pre>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("install");
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("ai-lite:theme") || "light");
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("ai-lite:lang") as Lang) || "zh");
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem("ai-lite:guide-done") !== "1");
  const [unlocked, setUnlocked] = useState(false);
  const [machineCode, setMachineCode] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const t = makeT(lang);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ai-lite:theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ai-lite:lang", lang);
  }, [lang]);

  useEffect(() => {
    if (unlocked) return;
    void invoke<string>("get_unlock_challenge")
      .then((mc) => {
        setMachineCode(mc);
        try {
          const saved = JSON.parse(localStorage.getItem("ai-lite:saved-code") || "{}");
          if (saved.machineCode === mc && saved.code) setCode(saved.code);
        } catch {
          /* ignore */
        }
      })
      .catch(() => setMachineCode(""));
  }, [unlocked]);

  const submitCode = async () => {
    setErr("");
    try {
      const ok = await invoke<boolean>("verify_unlock_code", { code });
      if (ok) {
        try {
          localStorage.setItem("ai-lite:saved-code", JSON.stringify({ machineCode, code }));
        } catch {
          /* ignore */
        }
        setUnlocked(true);
      } else {
        setErr(t("wrongCode"));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const copyMachine = async () => {
    try {
      await navigator.clipboard.writeText(machineCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  if (!unlocked) {
    return (
      <main className="unlock-screen">
        <div className="unlock-panel">
          <div className="brand">
            <span className="brand-logo">AI</span>
            <div>
              <h1>AI Lite</h1>
              <p className="brand-sub">{t("unlockSub")}</p>
            </div>
            <button className="theme-toggle" style={{ marginLeft: "auto" }} onClick={() => setLang((l) => (l === "zh" ? "en" : "zh"))}>
              {lang === "zh" ? "EN" : "中"}
            </button>
          </div>
          <div className="unlock-notice">
            <div>
              <strong>{t("followQr")}</strong>
              <span>{t("sendMachineCode")}</span>
            </div>
            <img className="unlock-qr" src={qrcode} alt="QR" />
          </div>
          <label className="unlock-field">
            {t("machineCode")}
            <div className="unlock-copy-row">
              <input value={machineCode || t("generating")} readOnly />
              <button className="secondary-button" disabled={!machineCode} onClick={() => void copyMachine()}>
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
          </label>
          <label className="unlock-field">
            {t("unlockCode")}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("unlockPlaceholder")}
              autoFocus
            />
          </label>
          {err && <div className="status err">{err}</div>}
          <button disabled={!code || !machineCode} onClick={() => void submitCode()}>
            {t("enter")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <LangContext.Provider value={lang}>
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">AI</span>
          <div>
            <h1>AI Lite</h1>
            <p className="brand-sub">{t("brandSub")}</p>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "install" ? "active" : ""} onClick={() => setTab("install")}>
            {t("tabInstall")}
          </button>
          <button className={tab === "api" ? "active" : ""} onClick={() => setTab("api")}>
            {t("tabApi")}
          </button>
          <button className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}>
            {t("tabKeys")}
          </button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            {t("tabHistory")}
          </button>
          <button className={tab === "diagnostics" ? "active" : ""} onClick={() => setTab("diagnostics")}>
            {t("tabDiagnostics")}
          </button>
          <button className="theme-toggle" onClick={() => setLang((l) => (l === "zh" ? "en" : "zh"))}>
            {lang === "zh" ? "EN" : "中"}
          </button>
          <button className="theme-toggle" title={t("themeToggle")} onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </nav>
      </header>
      {tab === "install" && <InstallCenter />}
      {tab === "api" && <ApiTester />}
      {tab === "keys" && <KeyManager />}
      {tab === "history" && <HistoryPage />}
      {tab === "diagnostics" && <DiagnosticsPage />}
      {showGuide && (
        <div className="guide-mask" onClick={() => { localStorage.setItem("ai-lite:guide-done", "1"); setShowGuide(false); }}>
          <div className="guide-card" onClick={(e) => e.stopPropagation()}>
            <h2>{t("guideTitle")}</h2>
            <ul>
              <li><strong>{t("tabInstall")}</strong>：{lang === "zh" ? "一键安装各家 AI CLI；已装的可「启动 ▾」选端点跑起来。" : "Install AI CLIs; launch installed ones via Launch ▾."}</li>
              <li><strong>{t("tabApi")}</strong>：{lang === "zh" ? "测试 Key 是否可用，成功后可保存。" : "Test a key, save it on success."}</li>
              <li><strong>{t("tabKeys")}</strong>：{lang === "zh" ? "集中管理保存的 Key，可命名、测试、分组。" : "Manage saved keys: name, test, group."}</li>
              <li><strong>{t("tabHistory")} / {t("tabDiagnostics")}</strong>：{lang === "zh" ? "查看启动记录、检查环境与日志。" : "View launch history, check env & logs."}</li>
            </ul>
            <button onClick={() => { localStorage.setItem("ai-lite:guide-done", "1"); setShowGuide(false); }}>
              {t("guideOk")}
            </button>
          </div>
        </div>
      )}
    </main>
    </LangContext.Provider>
  );
}

export default App;
