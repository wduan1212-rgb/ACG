/* 应用入口：装载数据 → 迁移 → 恢复任务 → 外壳 → 路由 */

import { $, $$, esc, gradFor } from "./core/util.js";
import { icon, brandMark } from "./ui/icons.js";
import { db } from "./core/db.js";
import { state, save, on, loadAll, persistNow, activeAccount } from "./core/store.js";
import { migrateFromV4 } from "./core/migrate.js";
import { preloadBlobUrls } from "./domain/assets.js";
import { createAccount, groupOf, platChip } from "./domain/accounts.js";
import { applyKeyOverrides } from "./api/llm.js";
import "./api/providers.js";
import { resumeJobs } from "./api/jobs.js";
import { resumeActiveBatches } from "./agent/orchestrator.js";
import { registerView, initRouter, render, go, parseHash } from "./core/router.js";
import { toast, openPalette, toggleNotifyPanel, updateNotifyBadge } from "./ui/components.js";
import { overviewView } from "./views/overview.js";
import { agentView } from "./agent/view.js";
import { studioView } from "./views/studio.js";
import { assetsView } from "./views/assetsView.js";
import { deliveryView } from "./views/deliveryView.js";
import { settingsView } from "./views/settings.js";
import "./views/accountDialog.js";
import { stagePage, openProductionDrawer } from "./views/prodDrawer.js";
import { productionsOf } from "./domain/productions.js";

/* ---------- 种子数据（首次使用且无迁移数据时） ---------- */
function seedIfEmpty() {
  if (state.accounts.length) return;
  const seeds = [
    { name: "Dumate 图文教程 01", platform: "小红书", mode: "图文", position: "办公效率教程，围绕 Dumate 文件整理 / 数据分析等功能，少广告腔、强操作演示", qtags: ["职场效率", "产品功能"] },
    { name: "AI 办公口播号", platform: "视频号", mode: "视频", subType: "数字人", position: "数字人出镜讲职场效率，前段真人引入、后段产品演示，定位真实办公痛点", qtags: ["职场效率"] },
    { name: "ACG 探场官", platform: "小红书", mode: "视频", subType: "无数字人", position: "探场体验官人设，现场探店 + 产品功能演示结合，活动现场素材二次创作", qtags: ["创作者", "测评中立"] }
  ];
  seeds.forEach(s => createAccount(s));
  state.ui.activeAccountId = state.accounts[0].id;
  save("accounts", "meta");
}

/* ---------- 登录分流 ---------- */
function showGate() {
  const gate = $("#loginGate");
  gate.hidden = false;
  document.body.classList.add("gated");
}
function enterRole(role) {
  state.role = role;
  save("meta");
  $("#loginGate").hidden = true;
  document.body.classList.remove("gated");
  document.body.classList.toggle("role-supplier", role === "supplier");
  go(role === "supplier" ? "delivery" : "overview");
  render();
  toast(role === "supplier" ? "已以供应商身份进入素材库" : "欢迎回来");
}
function logout() {
  state.role = null;
  save("meta");
  document.body.classList.remove("role-supplier");
  showGate();
}

/* ---------- 上下文面板（创作空间 = 账号列表） ---------- */
const collapsedGroups = new Set(state.ui.collapsedGroups || []);
function renderContextPanel() {
  const panel = $("#ctxPanel");
  const zone = document.body.dataset.zone;
  const show = zone === "studio" && state.role !== "supplier";
  panel.hidden = !show;
  document.body.classList.toggle("has-panel", show);
  if (!show) return;
  const q = (panel.dataset.q || "").toLowerCase();
  const f = a => a.name.toLowerCase().includes(q);
  const groups = [
    { key: "图文组", list: state.accounts.filter(a => a.mode === "图文" && f(a)) },
    { key: "真人 · 数字人", list: state.accounts.filter(a => a.mode === "视频" && a.subType === "数字人" && f(a)) },
    { key: "素材 · 无数字人", list: state.accounts.filter(a => a.mode === "视频" && a.subType !== "数字人" && f(a)) }
  ];
  panel.innerHTML = `
    <div class="ctx-head">
      <b>账号矩阵</b>
      <button class="icon-btn sm" id="ctxNew" title="创建账号">${icon("plus", 14)}</button>
    </div>
    <div class="ctx-search">${icon("search", 13)}<input id="ctxSearch" placeholder="搜索账号" value="${esc(panel.dataset.q || "")}" /></div>
    <div class="ctx-groups">
      ${groups.map(g => {
        const collapsed = collapsedGroups.has(g.key) && !q;
        return `<div class="ctx-group">
          <button class="ctx-gtitle" data-g="${esc(g.key)}"><span class="chev ${collapsed ? "closed" : ""}">${icon("chevronDown", 12)}</span>${esc(g.key)}<em>${g.list.length}</em></button>
          ${collapsed ? "" : g.list.map(a => `
            <button class="ctx-acc ${a.id === state.ui.activeAccountId ? "is-active" : ""}" data-acc="${a.id}">
              <span class="dot" style="background:${gradFor(a.name)}"></span>
              <span class="ctx-name">${esc(a.name)}</span>
              ${platChip(a.platform, true)}
              <em>${a.monthlyDone || 0}</em>
            </button>`).join("")}
        </div>`;
      }).join("")}
    </div>`;
  $("#ctxNew").addEventListener("click", () => document.dispatchEvent(new CustomEvent("open-account-dialog", { detail: {} })));
  $("#ctxSearch").addEventListener("input", e => { panel.dataset.q = e.target.value; renderContextPanel(); setTimeout(() => { const i = $("#ctxSearch"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 0); });
  $$(".ctx-gtitle", panel).forEach(b => b.addEventListener("click", () => {
    collapsedGroups.has(b.dataset.g) ? collapsedGroups.delete(b.dataset.g) : collapsedGroups.add(b.dataset.g);
    state.ui.collapsedGroups = [...collapsedGroups]; save("meta");
    renderContextPanel();
  }));
  $$(".ctx-acc", panel).forEach(b => b.addEventListener("click", () => {
    state.ui.activeAccountId = b.dataset.acc;
    state.ui.activeProductionId = null;
    save("meta");
    go("studio");
    render();
  }));
}

/* ---------- 顶栏 ---------- */
const ZONE_TITLE = { overview: "总览", agent: "Agent 工作台", studio: "创作空间", assets: "资产库", delivery: "交付中心", settings: "设置" };
function renderTopbar() {
  const zone = document.body.dataset.zone;
  const bc = $("#topCrumb");
  const acc = activeAccount();
  const { page } = parseHash();
  let crumb = ZONE_TITLE[zone] || "";
  if (zone === "studio" && acc) crumb = `创作空间 / ${acc.name}${page && page !== "home" ? " / " + ({ script: "脚本", boards: "分镜", images: "成图", prompts: "提示词", render: "生成台", cut: "剪辑", copy: "文案", review: "审核" }[page] || "") : ""}`;
  bc.textContent = crumb;
}

/* ---------- ⌘K ---------- */
function paletteCommands() {
  const cmds = [
    { label: "总览", group: "导航", icon: "grid", run: () => go("overview") },
    { label: "Agent 工作台", group: "导航", icon: "spark", run: () => go("agent") },
    { label: "创作空间", group: "导航", icon: "film", run: () => go("studio") },
    { label: "资产库", group: "导航", icon: "folder", run: () => go("assets") },
    { label: "交付中心", group: "导航", icon: "package", run: () => go("delivery") },
    { label: "设置", group: "导航", icon: "gear", run: () => go("settings") },
    { label: "创建账号", group: "操作", icon: "plus", run: () => document.dispatchEvent(new CustomEvent("open-account-dialog", { detail: {} })) }
  ];
  state.accounts.forEach(a => cmds.push({
    label: a.name, hint: a.position.slice(0, 24), group: "账号", icon: "user",
    run: () => { state.ui.activeAccountId = a.id; save("meta"); go("studio"); render(); }
  }));
  state.productions.filter(p => p.stage !== "delivered").slice(0, 30).forEach(p => cmds.push({
    label: p.artifacts.copy.title || p.title || p.topic || "未命名任务",
    hint: "在制任务", group: "任务", icon: "film",
    run: () => openProductionDrawer(p.id)
  }));
  return cmds;
}

/* ---------- 启动 ---------- */
async function boot() {
  try {
    await db.open();
    await loadAll();
    const mig = await migrateFromV4();
    if (mig.migrated) {
      await persistNow();
      setTimeout(() => toast(`已从旧版迁移：${mig.counts.accounts} 账号 / ${mig.counts.productions} 任务 / ${mig.counts.assets} 资产（旧数据保留可回退）`), 800);
    }
    await preloadBlobUrls();
    seedIfEmpty();
    applyKeyOverrides(state.apiKeys);

    // 注册路由
    registerView("overview", overviewView);
    registerView("agent", agentView);
    registerView("studio", studioView);
    registerView("assets", assetsView);
    registerView("delivery", deliveryView);
    registerView("settings", settingsView);
    initRouter();

    // 外壳
    $("#railBrand").innerHTML = brandMark(30);
    $$("[data-nav]").forEach(b => b.addEventListener("click", () => go(b.dataset.nav)));
    $("#navLogout").addEventListener("click", logout);
    $("#topSearch").addEventListener("click", () => openPalette(paletteCommands()));
    $("#topBell").addEventListener("click", e => toggleNotifyPanel(e.currentTarget));
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(paletteCommands()); }
    });
    window.addEventListener("view:rendered", () => { renderContextPanel(); renderTopbar(); });
    on("change", () => { if (document.body.dataset.zone === "studio") renderContextPanel(); updateNotifyBadge(); });
    updateNotifyBadge();

    // 登录分流
    $$("#loginGate .lg-role").forEach(b => b.addEventListener("click", () => enterRole(b.dataset.role)));
    const lgp = $("#lgParticles");
    for (let i = 0; i < 20; i++) {
      const p = document.createElement("i");
      p.style.setProperty("--x", (Math.random() * 100).toFixed(1) + "%");
      p.style.setProperty("--d", (Math.random() * 9).toFixed(2) + "s");
      p.style.setProperty("--t", (8 + Math.random() * 8).toFixed(2) + "s");
      lgp.appendChild(p);
    }

    // 恢复中断任务
    const rj = resumeJobs();
    const rb = resumeActiveBatches();
    if (rj || rb) setTimeout(() => toast(`已恢复中断的工作：${rb ? `${rb} 条起草接续 · ` : ""}${rj ? `${rj} 个渲染任务重新排队` : ""}`.replace(/ · $/, "")), 1200);

    // 进入
    if (state.role) {
      document.body.classList.toggle("role-supplier", state.role === "supplier");
      $("#loginGate").hidden = true;
      render();
    } else {
      showGate();
      render(); // 背景先渲染好
    }

    // 兜底保存
    window.addEventListener("beforeunload", persistNow);
    document.addEventListener("visibilitychange", () => { if (document.hidden) persistNow(); });
  } catch (e) {
    console.error("[boot]", e);
    document.body.innerHTML = `<div style="padding:40px;font-family:system-ui"><h2>启动失败</h2><p>${esc(e.message || String(e))}</p><p>请用 <code>python3 -m http.server 4173</code> 启动后访问（ES Modules 不支持 file:// 直接打开），或回退 _backup_v4/。</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", boot);
