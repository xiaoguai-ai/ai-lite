// 轻量多语言：中文 / English。新增文案在两个字典各加一条即可。
export type Lang = "zh" | "en";

export const STRINGS: Record<string, { zh: string; en: string }> = {
  brandSub: { zh: "一键安装 AI 工具 · 调用测试", en: "Install AI tools · API testing" },
  tabInstall: { zh: "安装中心", en: "Install" },
  tabApi: { zh: "API 测试", en: "API Test" },
  tabKeys: { zh: "Key 管理", en: "Keys" },
  tabHistory: { zh: "启动历史", en: "History" },
  tabDiagnostics: { zh: "体检", en: "Diagnostics" },
  themeToggle: { zh: "切换深色/浅色", en: "Toggle dark/light" },

  // 安装中心
  installHint: {
    zh: "点击国家标题可展开或收起。已安装的工具会显示「打开」，未安装的工具可直接安装，也可跳转官网/下载页。",
    en: "Click a region to expand/collapse. Installed tools show Open; others can be installed or opened on their site.",
  },
  nodeTitle: { zh: "Node.js LTS", en: "Node.js LTS" },
  nodeDesc: { zh: "多数 AI CLI 需要 Node.js / npm；先装它再装工具更稳。", en: "Most AI CLIs need Node.js / npm; install it first." },
  download: { zh: "下载", en: "Download" },
  installNode: { zh: "安装 Node.js", en: "Install Node.js" },
  searchPlaceholder: { zh: "搜索工具（名称 / 描述 / 厂商）", en: "Search tools (name / desc / vendor)" },
  refreshAll: { zh: "刷新全部", en: "Refresh all" },
  pinned: { zh: "★ 置顶常用", en: "★ Pinned" },
  launch: { zh: "启动 ▾", en: "Launch ▾" },
  menu: { zh: "菜单 ▾", en: "Menu ▾" },
  install: { zh: "安装", en: "Install" },
  installing: { zh: "安装中…", en: "Installing…" },
  checking: { zh: "检测中…", en: "Checking…" },
  detect: { zh: "检测", en: "Detect" },
  notChecked: { zh: "未检测", en: "Not checked" },
  open: { zh: "打开", en: "Open" },
  opening: { zh: "打开中…", en: "Opening…" },
  uninstall: { zh: "卸载", en: "Uninstall" },
  innerWindow: { zh: "内置窗口", en: "In-app window" },
  needNode: { zh: "需要 Node.js", en: "Needs Node.js" },
  hasDownload: { zh: "有下载页", en: "Has page" },
  installed: { zh: "已安装", en: "Installed" },
  onlyDownload: { zh: "仅下载", en: "Download only" },

  // 启动面板
  baseUrl: { zh: "Base URL", en: "Base URL" },
  apiKey: { zh: "API Key", en: "API Key" },
  model: { zh: "模型", en: "Model" },
  selectFromKeys: { zh: "从 Key 管理选择…", en: "Pick from Keys…" },
  start: { zh: "启动", en: "Start" },
  starting: { zh: "启动中…", en: "Starting…" },
  checkConn: { zh: "检测连通性", en: "Check connection" },
  favRelay: { zh: "收藏中转站", en: "Save relay" },
  savedRelays: { zh: "收藏的中转站", en: "Saved relays" },
  close: { zh: "关闭", en: "Close" },

  // API 测试
  provider: { zh: "服务商", en: "Provider" },
  message: { zh: "消息", en: "Message" },
  send: { zh: "发送", en: "Send" },
  sending: { zh: "发送中…", en: "Sending…" },
  saveThisConfig: { zh: "＋ 保存这个配置", en: "+ Save this config" },
  alreadySaved: { zh: "✓ 已保存此配置", en: "✓ Saved" },

  // Key 管理
  keysHint: {
    zh: "集中管理在「API 测试」中保存的 Key，可命名、测试有效性、复制。按服务商分组。Key 仅保存在本机。",
    en: "Manage keys saved from API Test: name, test, copy. Grouped by provider. Stored locally only.",
  },
  refresh: { zh: "刷新", en: "Refresh" },
  noKeys: { zh: "还没有保存的 Key。去「API 测试」测试成功后点「保存这个配置」即可。", en: "No saved keys yet. Save one from API Test." },
  testValidity: { zh: "测试有效性", en: "Test" },
  testing: { zh: "测试中…", en: "Testing…" },
  rename: { zh: "重命名", en: "Rename" },
  viewKey: { zh: "查看 Key", en: "Show key" },
  hideKey: { zh: "隐藏 Key", en: "Hide key" },
  copyKey: { zh: "复制 Key", en: "Copy key" },
  copied: { zh: "已复制", en: "Copied" },
  remove: { zh: "删除", en: "Delete" },

  // 历史 / 体检
  historyHint: { zh: "记录每次通过「启动」拉起 CLI 的时间、工具、端点和模型（仅本机，最多 100 条）。", en: "Logs each launch: time, tool, endpoint, model (local, up to 100)." },
  clear: { zh: "清空", en: "Clear" },
  noHistory: { zh: "还没有启动记录。", en: "No launch history yet." },
  diagHint: { zh: "一键检查运行环境与依赖状态，并查看后台日志。", en: "Check environment & dependencies, and view logs." },
  recheck: { zh: "重新检查", en: "Recheck" },
  normal: { zh: "正常", en: "OK" },
  missing: { zh: "缺失", en: "Missing" },
  logView: { zh: "日志查看", en: "Logs" },

  // 解锁
  unlockSub: { zh: "请输入验证码后继续", en: "Enter unlock code to continue" },
  followQr: { zh: "关注\"小怪不懂经典\"公众号", en: "Follow the official account" },
  sendMachineCode: { zh: "发送机器码获取验证码", en: "Send machine code to get the unlock code" },
  machineCode: { zh: "机器码", en: "Machine code" },
  unlockCode: { zh: "验证码", en: "Unlock code" },
  unlockPlaceholder: { zh: "输入解码器生成的验证码", en: "Enter the generated unlock code" },
  enter: { zh: "进入", en: "Enter" },
  generating: { zh: "正在生成...", en: "Generating..." },
  copy: { zh: "复制", en: "Copy" },
  wrongCode: { zh: "验证码不正确", en: "Incorrect code" },

  // 引导
  guideTitle: { zh: "欢迎使用 AI Lite 👋", en: "Welcome to AI Lite 👋" },
  guideOk: { zh: "知道了", en: "Got it" },
};

import { createContext, useContext } from "react";

export function makeT(lang: Lang) {
  return (key: keyof typeof STRINGS) => STRINGS[key]?.[lang] ?? STRINGS[key]?.zh ?? String(key);
}

export const LangContext = createContext<Lang>("zh");
export function useT() {
  const lang = useContext(LangContext);
  return makeT(lang);
}
