/* 应用入口：装载数据 → 迁移 → 恢复任务 → 外壳 → 路由 */

import { $, $$, esc, gradFor, uid } from "./core/util.js";
import { icon, brandGlyph } from "./ui/icons.js";
import { db } from "./core/db.js";
import { state, save, saveMembers, on, loadAll, persistNow, activeAccount, ROLE_LABEL } from "./core/store.js";
import { pruneEmptySessions } from "./agent/orchestrator.js";
import { migrateFromV4 } from "./core/migrate.js";
import { preloadBlobUrls, materializeStaticAssets } from "./domain/assets.js";
import { groupOf, platChip, deleteAccount } from "./domain/accounts.js";
import { seedDemoIfEmpty } from "./domain/demo.js";
import { applyKeyOverrides } from "./api/llm.js";
import "./api/providers.js";
import { resumeJobs } from "./api/jobs.js";
import { resumeActiveBatches } from "./agent/orchestrator.js";
import { registerView, initRouter, render, go, parseHash } from "./core/router.js";
import { toast, confirmModal, openPalette, toggleNotifyPanel, updateNotifyBadge } from "./ui/components.js";
import { overviewView } from "./views/overview.js";
import { agentView } from "./agent/view.js";
import { studioView } from "./views/studio.js";
import { assetsView } from "./views/assetsView.js";
import { deliveryView } from "./views/deliveryView.js";
import { analyticsView } from "./views/analyticsView.js";
import { draftsView } from "./views/draftsView.js";
import { settingsView } from "./views/settings.js";
import "./views/accountDialog.js";
import { stagePage, openProductionDrawer } from "./views/prodDrawer.js";
import { productionsOf } from "./domain/productions.js";

/* ---------- 种子数据（首次使用且无迁移数据时） ---------- */
function seedIfEmpty() {
  seedDemoIfEmpty();
}

/* ---------- 登录（成员账号制：用户名 + 口令） ---------- */
function showGate() {
  const gate = $("#loginGate");
  gate.hidden = false;
  document.body.classList.add("gated");
  const u = $("#lgUser"), p = $("#lgPin");
  if (u) u.value = "admin"; if (p) p.value = "123";
  const hint = $("#lgHint");
  if (hint) hint.textContent = "演示管理员账号：admin / 123";
  setTimeout(() => u && u.focus(), 80);
}
function applyRoleClasses() {
  document.body.classList.toggle("role-supplier", state.role === "supplier");
  document.body.classList.toggle("role-editor", state.role === "editor");
  document.body.classList.toggle("role-admin", state.role === "admin");
}
function enterMember(member) {
  state.role = member.role;
  state.ui.currentMemberId = member.id;
  save("meta");
  $("#loginGate").hidden = true;
  document.body.classList.remove("gated");
  applyRoleClasses();
  go(member.role === "supplier" ? "delivery" : "overview");
  render();
  toast(`欢迎回来 · ${esc(member.name)}（${ROLE_LABEL[member.role] || ""}）`);
}
function shakeCard() {
  const card = $(".lg-card");
  card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
}
function wireGate() {
  const gate = $("#loginGate");
  // 仅登录：成员只能由管理员在设置里新增（不开放自助注册）
  const submit = () => {
    const username = ($("#lgUser").value || "").trim();
    const pin = ($("#lgPin").value || "").trim();
    if (!username || !pin) { toast("请填写用户名和密码"); shakeCard(); return; }
    const member = state.members.find(m => m.username === username && m.pin === pin);
    if (!member) { $("#lgPin").value = ""; shakeCard(); toast("用户名或密码不对，再试一次", "error"); return; }
    enterMember(member);
  };
  $("#lgLogin", gate).addEventListener("click", submit);
  gate.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
}
function logout() {
  state.role = null;
  state.ui.currentMemberId = null;
  save("meta");
  document.body.classList.remove("role-supplier", "role-editor", "role-admin");
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
  const oldGroups = $(".ctx-groups", panel);
  const oldScrollTop = oldGroups ? oldGroups.scrollTop : 0;
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
            <div class="ctx-acc ${a.id === state.ui.activeAccountId ? "is-active" : ""}" data-acc="${a.id}" role="button" tabindex="0">
              <span class="dot" style="background:${gradFor(a.name)}"></span>
              <span class="ctx-name">${esc(a.name)}</span>
              ${platChip(a.platform, true)}
              <em>${a.monthlyDone || 0}</em>
              ${state.role === "admin" ? `<button class="ctx-del" data-ctx-del="${a.id}" title="删除账号">${icon("trash", 12)}</button>` : ""}
            </div>`).join("")}
        </div>`;
      }).join("")}
    </div>`;
  const newGroups = $(".ctx-groups", panel);
  if (newGroups) newGroups.scrollTop = oldScrollTop;
  $("#ctxNew").addEventListener("click", () => document.dispatchEvent(new CustomEvent("open-account-dialog", { detail: {} })));
  $("#ctxSearch").addEventListener("input", e => { panel.dataset.q = e.target.value; renderContextPanel(); setTimeout(() => { const i = $("#ctxSearch"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 0); });
  $$(".ctx-gtitle", panel).forEach(b => b.addEventListener("click", () => {
    collapsedGroups.has(b.dataset.g) ? collapsedGroups.delete(b.dataset.g) : collapsedGroups.add(b.dataset.g);
    state.ui.collapsedGroups = [...collapsedGroups]; save("meta");
    renderContextPanel();
  }));
  $$(".ctx-del", panel).forEach(b => b.addEventListener("click", async e => {
    e.stopPropagation();
    const acc = state.accounts.find(a => a.id === b.dataset.ctxDel);
    if (!acc) return;
    const ok = await confirmModal({
      title: "删除账号",
      body: `确定删除「${esc(acc.name)}」吗？对应任务与素材会一并移除。`,
      okText: "删除",
      danger: true
    });
    if (!ok) return;
    deleteAccount(acc.id);
    renderContextPanel();
    render();
  }));
  $$(".ctx-acc", panel).forEach(b => {
    const open = () => {
      state.ui.activeAccountId = b.dataset.acc;
      state.ui.activeProductionId = null;
      save("meta");
      go("studio");
      render();
    };
    b.addEventListener("click", e => { if (!e.target.closest(".ctx-del")) open(); });
    b.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

/* ---------- 顶栏 ---------- */
const ZONE_TITLE = { overview: "首页", agent: "批量创作", studio: "单号创作", assets: "整体资产", drafts: "草稿箱", delivery: "发布清单", analytics: "数据分析", settings: "设置" };
function renderTopbar() {
  const zone = document.body.dataset.zone;
  const bc = $("#topCrumb");
  const acc = activeAccount();
  const { page } = parseHash();
  let crumb = ZONE_TITLE[zone] || "";
  if (zone === "studio" && acc) crumb = `单号创作 / ${acc.name}${page && page !== "home" ? " / " + ({ script: "脚本", boards: "分镜", images: "成图", prompts: "提示词", workshop: "分镜工坊", render: "生成台", cut: "剪辑", copy: "文案", review: "审核" }[page] || "") : ""}`;
  bc.textContent = crumb;
}

/* ---------- ⌘K ---------- */
function paletteCommands() {
  const cmds = [
    { label: "首页", group: "导航", icon: "grid", run: () => go("overview") },
    { label: "批量创作", group: "导航", icon: "spark", run: () => go("agent") },
    { label: "单号创作", group: "导航", icon: "film", run: () => go("studio") },
    { label: "整体资产", group: "导航", icon: "folder", run: () => go("assets") },
    { label: "草稿箱", group: "导航", icon: "inbox", run: () => go("drafts") },
    { label: "发布清单", group: "导航", icon: "package", run: () => go("delivery") },
    { label: "数据分析", group: "导航", icon: "pulse", run: () => go("analytics") },
    ...(state.role === "admin" ? [
      { label: "设置", group: "导航", icon: "gear", run: () => go("settings") },
      { label: "创建账号", group: "操作", icon: "plus", run: () => document.dispatchEvent(new CustomEvent("open-account-dialog", { detail: {} })) }
    ] : [])
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
    await materializeStaticAssets();
    pruneEmptySessions();
    applyKeyOverrides(state.apiKeys);

    // 注册路由
    registerView("overview", overviewView);
    registerView("agent", agentView);
    registerView("studio", studioView);
    registerView("assets", assetsView);
    registerView("drafts", draftsView);
    registerView("delivery", deliveryView);
    registerView("analytics", analyticsView);
    registerView("settings", settingsView);
    initRouter();

    // 外壳
    $("#railBrand").innerHTML = brandGlyph(28);
    $$("[data-nav]").forEach(b => b.addEventListener("click", () => { state.ui.returnTo = null; go(b.dataset.nav); }));
    $("#navLogout").addEventListener("click", logout);
    $("#topSearch").addEventListener("click", () => openPalette(paletteCommands()));
    document.addEventListener("click", e => {
      if (e.target.closest("[data-open-create-account]")) document.dispatchEvent(new CustomEvent("open-account-dialog", { detail: {} }));
    });
    $("#topBell").addEventListener("click", e => toggleNotifyPanel(e.currentTarget));
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(paletteCommands()); }
    });
    window.addEventListener("view:rendered", () => { renderContextPanel(); renderTopbar(); });
    on("change", () => { if (document.body.dataset.zone === "studio") renderContextPanel(); updateNotifyBadge(); });
    updateNotifyBadge();

    // 登录分流（三身份 + 口令）
    wireGate();
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

    // 进入（需已登录且成员仍有效）
    if (state.role && state.ui.currentMemberId) {
      applyRoleClasses();
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
