/* 创作空间：账号主页 + 链路分发（script/boards/images/prompts/render/cut/copy/review） */

import { $, $$, esc, gradFor, timeAgo } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, activeAccount, activeProduction, productionById } from "../core/store.js";
import { platChip, monthlyBarHtml, modeLabel, charBoardOf } from "../domain/accounts.js";
import { STAGES, flowOf, stageDone, statusPill, createProduction, productionsOf, deleteProduction } from "../domain/productions.js";
import { emptyState, toast, confirmModal, openLightbox } from "../ui/components.js";
import { go } from "../core/router.js";
import { openProductionDrawer, stagePage } from "./prodDrawer.js";
import { urlFor } from "../domain/assets.js";
import { renderScriptPage } from "./chainScript.js";
import { renderSlotsPage } from "./chainBoards.js";
import { renderPromptsPage } from "./chainPrompts.js";
import { renderRenderPage } from "./chainRender.js";
import { renderCutPage } from "./chainCut.js";
import { renderCopyPage, renderReviewPage } from "./chainCopy.js";

export const studioView = {
  render(root, { page }) {
    const acc = activeAccount();
    if (!acc) {
      root.innerHTML = emptyState("users", "还没有账号", "先创建第一个内容账号", `<button class="btn primary" data-open-create-account>${icon("plus", 14)} 创建账号</button>`);
      return;
    }
    if (!page || page === "home") return renderHome(root, acc);

    // 链路页需要一个在制 production
    const p = activeProduction();
    if (!p || p.accountId !== acc.id && !productionById(state.ui.activeProductionId)) {
      const mine = productionsOf(acc.id).filter(x => x.stage !== "delivered");
      if (mine.length) { state.ui.activeProductionId = mine[0].id; save("meta"); }
      else { toast("先开始一条新创作"); go("studio"); return; }
    }
    const prod = activeProduction();
    if (!prod) { go("studio"); return; }
    // 切换账号侧栏联动
    if (prod.accountId !== state.ui.activeAccountId) { state.ui.activeAccountId = prod.accountId; save("meta"); }

    const PAGES = {
      script: renderScriptPage,
      boards: (r, p2) => renderSlotsPage(r, p2, false),
      images: (r, p2) => renderSlotsPage(r, p2, true),
      prompts: renderPromptsPage,
      render: renderRenderPage,
      cut: renderCutPage,
      copy: renderCopyPage,
      review: renderReviewPage
    };
    const fn = PAGES[page];
    if (!fn) { go("studio"); return; }
    fn(root, prod);
  }
};

/* ---------- 链路 stepper（链路页共用头部） ---------- */
export function stepperHtml(p, currentPage) {
  const flow = flowOf(p.mode);
  return `<div class="chain-stepper">
    ${flow.map((st, i) => {
      const done = stageDone(p, st);
      const cur = pageStage(currentPage) === st;
      const fail = cur && p.stageStatus === "failed";
      return `<button class="cs-step ${cur ? "is-current" : ""} ${done ? "is-done" : ""} ${fail ? "is-fail" : ""}" data-chain="${stagePageName(st)}">
        <span class="cs-dot">${done && !cur ? icon("check", 11) : `<i>${i + 1}</i>`}</span>
        <span class="cs-label">${STAGES[st].label}</span>
      </button>${i < flow.length - 1 ? `<span class="cs-link ${done ? "on" : ""}"></span>` : ""}`;
    }).join("")}
    <span class="cs-spacer"></span>
    <span class="cs-prod" title="${esc(p.topic)}">${icon("film", 13)} ${esc((p.artifacts.copy.title || p.title || p.topic || "未命名").slice(0, 16))}</span>
  </div>`;
}
const pageStage = page => page === "render" ? "render" : page;
const stagePageName = st => st;

export function wireStepper(root) {
  $$("[data-chain]", root).forEach(b => b.addEventListener("click", () => go("studio", b.dataset.chain)));
}

/* ---------- 账号主页 ---------- */
function renderHome(root, acc) {
  const prods = productionsOf(acc.id);
  const inflight = prods.filter(p => p.stage !== "delivered");
  const delivered = prods.filter(p => p.stage === "delivered").slice(0, 6);
  const flow = flowOf(acc.mode);
  const board = charBoardOf(acc);

  root.innerHTML = `
    <div class="studio-home">
      <header class="sh-head card">
        <div class="sh-id">
          <span class="sh-avatar" style="background:${gradFor(acc.name)}">${esc(acc.name[0])}</span>
          <div class="sh-meta">
            <h2>${esc(acc.name)}</h2>
            <div class="sh-sub">${platChip(acc.platform, true)}<span class="tag">${modeLabel(acc)}</span>${monthlyBarHtml(acc, true)}</div>
            <p class="sh-pos">${esc(acc.position)}</p>
          </div>
        </div>
        <div class="sh-actions">
          ${acc.mode === "视频" && acc.subType === "数字人" ? `<button class="btn ghost" data-sh="charboard">${icon("user", 14)} 角色身份版</button>` : ""}
          <button class="btn ghost" data-sh="edit">${icon("edit", 14)} 编辑账号</button>
          <button class="btn primary" data-sh="new">${icon("plus", 14)} 开始新创作</button>
        </div>
      </header>

      <section class="sh-flow card">
        <div class="card-head"><b>创作链路</b><em>${acc.mode === "图文" ? "脚本 → 成图（站外回传）→ 文案 → 审核 → 交付" : "脚本 → 分镜 → 提示词 → 生成 → 智能剪辑 → 文案 → 审核 → 交付"}</em></div>
        <div class="sh-flow-steps">
          ${flow.map((st, i) => `
            <button class="fs-card" data-sh-flow="${st}" style="--d:${i * 40}ms">
              <span class="fs-ico">${icon(STAGES[st].icon, 18)}<i class="fs-num">${i + 1}</i></span>
              <b>${STAGES[st].label}</b>
            </button>${i < flow.length - 1 ? `<span class="fs-arrow">${icon("chevronRight", 14)}</span>` : ""}`).join("")}
        </div>
      </section>

      <section class="sh-prods card">
        <div class="card-head"><b>在制任务</b><em>${inflight.length} 条</em></div>
        ${inflight.length ? `<div class="sh-prod-list">${inflight.map(p => {
          const [label, cls] = statusPill(p);
          return `<div class="shp-row" data-prod="${p.id}">
            <span class="shp-stage">${icon(STAGES[p.stage].icon, 14)}</span>
            <span class="shp-main"><b>${esc(p.artifacts.copy.title || p.title || p.topic || "未命名创作")}</b>
            <em>${p.origin === "agent" ? "Agent 批次 · " : ""}${STAGES[p.stage].label} · ${timeAgo(p.updatedAt)}</em></span>
            <span class="status-pill ${cls}">${label}</span>
            <button class="icon-btn sm" data-prod-del="${p.id}" title="删除任务">${icon("trash", 13)}</button>
            <button class="btn ghost sm" data-prod-go="${p.id}">继续 ${icon("arrowRight", 12)}</button>
          </div>`;
        }).join("")}</div>` : emptyState("film", "没有在制任务", "点击「开始新创作」或让 Agent 批量发起")}
      </section>

      <section class="sh-delivered card">
        <div class="card-head"><b>最近交付</b><button class="link-btn" data-sh="delivery">交付中心 ${icon("arrowRight", 12)}</button></div>
        ${delivered.length ? `<div class="sh-dl-grid">${delivered.map(p => {
          const items = (p.mode === "图文" ? p.artifacts.images.items : p.artifacts.boards.items) || [];
          const cover = items.find(x => x.assetId);
          const u = cover ? urlFor(cover.assetId) : null;
          return `<button class="sh-dl" data-prod="${p.id}">
            ${u ? `<img src="${u}"/>` : `<i style="background:${gradFor(p.title || p.id)}">${p.mode === "图文" ? "图" : "▶"}</i>`}
            <b>${esc(p.artifacts.copy.title || p.title)}</b><em>${esc(p.delivery?.name || "")}</em>
          </button>`;
        }).join("")}</div>` : `<div class="muted" style="padding:6px 2px">还没有交付记录</div>`}
      </section>
    </div>`;

  root.querySelectorAll("[data-prod-go]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const p = productionById(b.dataset.prodGo);
    state.ui.activeProductionId = p.id; save("meta");
    go("studio", stagePage(p));
  }));
  root.querySelectorAll("[data-prod-del]").forEach(b => b.addEventListener("click", async e => {
    e.stopPropagation();
    const p = productionById(b.dataset.prodDel);
    const ok = await confirmModal({ title: `删除任务「${p.title || p.topic || "未命名"}」？`, body: "该任务的脚本/提示词等中间产物会被移除（已入库资产保留）。", danger: true, okText: "删除" });
    if (ok) { deleteProduction(p.id); renderHome(root, acc); }
  }));
  root.querySelectorAll("[data-prod]").forEach(el => el.addEventListener("click", () => openProductionDrawer(el.dataset.prod)));
  root.querySelectorAll("[data-sh-flow]").forEach(b => b.addEventListener("click", () => {
    const inflight2 = productionsOf(acc.id).filter(p => p.stage !== "delivered");
    if (!inflight2.length) { toast("先开始一条新创作"); return; }
    state.ui.activeProductionId = inflight2[0].id; save("meta");
    go("studio", b.dataset.shFlow);
  }));
  const onAct = {
    new: () => {
      const p = createProduction({ accountId: acc.id, origin: "manual" });
      state.ui.activeProductionId = p.id; save("meta");
      go("studio", "script");
    },
    edit: () => document.dispatchEvent(new CustomEvent("open-account-dialog", { detail: { accountId: acc.id } })),
    charboard: () => {
      const b = charBoardOf(acc);
      const u = b ? urlFor(b) : null;
      if (u) {
        const img = document.createElement("img"); img.src = u;
        img.style.cssText = "position:fixed;left:50%;top:50%;width:60px;height:40px;opacity:0";
        document.body.appendChild(img);
        openLightbox(img, u, acc.name + " 角色身份版");
        setTimeout(() => img.remove(), 600);
      } else toast("还没有角色身份版，编辑账号可生成或上传");
    },
    delivery: () => go("delivery")
  };
  root.querySelectorAll("[data-sh]").forEach(b => b.addEventListener("click", () => onAct[b.dataset.sh] && onAct[b.dataset.sh]()));
}
