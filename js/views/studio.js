/* 创作空间：账号主页 + 链路分发（script/boards/images/prompts/render/cut/copy/review） */

import { $, $$, esc, gradFor, timeAgo, wireDropZone } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, activeAccount, activeProduction, productionById, canManageAccounts } from "../core/store.js";
import { platChip, monthlyBarHtml, modeLabel, charBoardOf, accountAssets } from "../domain/accounts.js";
import { STAGES, flowOf, normalizeStage, stageDone, statusPill, createProduction, productionsOf, deleteProduction, isMaterial } from "../domain/productions.js";
import { emptyState, toast, confirmModal, openLightbox } from "../ui/components.js";
import { go } from "../core/router.js";
import { openProductionDrawer, stagePage } from "./prodDrawer.js";
import { urlFor, thumbHtml, assetCode, addAssetFromFile } from "../domain/assets.js";
import { renderScriptPage } from "./chainScript.js";
import { renderSlotsPage } from "./chainBoards.js";
import { renderPromptsPage } from "./chainPrompts.js";
import { renderRenderPage } from "./chainRender.js";
import { renderWorkshopPage } from "./chainWorkshop.js";
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
      workshop: renderWorkshopPage,
      render: renderRenderPage,
      cut: renderCutPage,
      copy: renderCopyPage,
      review: renderReviewPage
    };
    // 链路类型守卫：素材号的 分镜/提示词/生成 统一进工坊；其余类型不进工坊
    let target = page;
    if (isMaterial(prod) && ["boards", "prompts", "render"].includes(page)) target = "workshop";
    if (!isMaterial(prod) && page === "workshop") target = prod.mode === "图文" ? "images" : "boards";
    const fn = PAGES[target];
    if (!fn) { go("studio"); return; }
    fn(root, prod);
  }
};

/* ---------- 链路 stepper（链路页共用头部） ---------- */
const RETURN_LABEL = { agent: "返回批量创作", delivery: "返回发布清单", overview: "返回首页", assets: "返回整体资产", drafts: "返回草稿箱", studio: "返回账号主页" };

export function stepperHtml(p, currentPage) {
  const flow = flowOf(p);
  const rt = state.ui.returnTo;
  return `<div class="chain-stepper">
    ${rt ? `<button class="cs-back" data-cs-back>${icon("arrowLeft", 14)} ${RETURN_LABEL[rt.zone] || "返回"}</button>` : ""}
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
  const back = $("[data-cs-back]", root);
  if (back) back.addEventListener("click", () => {
    const rt = state.ui.returnTo;
    state.ui.returnTo = null; save("meta");
    if (rt && rt.zone) go(rt.zone, rt.page); else history.back();
  });
}

/* ---------- 账号主页 ---------- */
function renderHome(root, acc) {
  if (state.ui.returnTo) { state.ui.returnTo = null; save("meta"); }   // 到账号主页即清掉微调返回态
  const prods = productionsOf(acc.id);
  const inflight = prods.filter(p => p.stage !== "delivered");
  const delivered = prods.filter(p => p.stage === "delivered").slice(0, 6);
  const flow = flowOf(acc);
  const board = charBoardOf(acc);
  const admin = canManageAccounts();
  const accAssets = accountAssets(acc.id);

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
          ${admin ? `<button class="btn ghost" data-sh="edit">${icon("edit", 14)} 编辑账号</button>` : ""}
          <button class="btn primary" data-sh="new">${icon("plus", 14)} 开始新创作</button>
        </div>
      </header>

      <section class="sh-flow card">
        <div class="card-head"><b>创作链路</b><em>${acc.mode === "图文" ? "脚本 → 成图（站外上传）→ 文案 → 审核 → 交付" : acc.subType === "无数字人" ? "脚本（含口播音频）→ 分镜工坊（一体节点）→ 智能混剪+BGM → 文案 → 审核 → 交付" : "脚本 → 分镜 → 提示词 → 生成 → 智能剪辑 → 文案 → 审核 → 交付"}</em></div>
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

      <section class="sh-assets card">
        <div class="card-head"><b>账号资产库</b><div class="head-actions"><em>${accAssets.length} 个素材</em>
          <label class="link-btn">${icon("upload", 12)} 上传<input type="file" accept="image/*,video/*,audio/*" multiple hidden id="shAssetUp" /></label>
          <button class="link-btn" id="shAssetAll">整体资产 ${icon("arrowRight", 12)}</button></div></div>
        ${accAssets.length ? `<div class="sh-asset-grid">${accAssets.slice(0, 14).map(a => `
          <div class="sh-asset" data-aid="${a.id}" title="${esc(a.name)}">
            ${thumbHtml(a)}${a.seq ? `<span class="sh-asset-seq">${assetCode(a)}</span>` : ""}${a.type === "视频" ? `<span class="ac-play">${icon("play", 12)}</span>` : ""}
          </div>`).join("")}${accAssets.length > 14 ? `<button class="sh-asset more" id="shAssetMore">+${accAssets.length - 14}</button>` : ""}</div>`
        : `<div class="sh-asset-drop" id="shAssetDrop">${icon("folder", 18)}<span>该账号还没有素材，拖图到此或点上方上传 · 生成时可 @ 调用</span></div>`}
      </section>

      <section class="sh-delivered card">
        <div class="card-head"><b>最近交付</b><button class="link-btn" data-sh="delivery">发布清单 ${icon("arrowRight", 12)}</button></div>
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

  // 账号资产库
  async function uploadToAccount(files) {
    let n = 0;
    for (const f of Array.from(files)) { await addAssetFromFile(acc.id, f); n++; }
    if (n) { toast(`已上传 ${n} 个素材到「${acc.name}」资产库`); renderHome(root, acc); }
  }
  const shUp = $("#shAssetUp", root);
  if (shUp) shUp.addEventListener("change", e => uploadToAccount(e.target.files));
  const goAllAssets = () => { state.ui.assetsFilterAccount = acc.id; go("assets"); };
  const shAll = $("#shAssetAll", root); if (shAll) shAll.addEventListener("click", goAllAssets);
  const shMore = $("#shAssetMore", root); if (shMore) shMore.addEventListener("click", goAllAssets);
  root.querySelectorAll(".sh-asset[data-aid]").forEach(el => {
    const a = state.assets.find(x => x.id === el.dataset.aid);
    if (!a) return;
    const img = el.querySelector("img");
    el.addEventListener("click", () => { if (img && a.type !== "音频") openLightbox(img, urlFor(a), a.name); else goAllAssets(); });
  });
  const drop = $("#shAssetDrop", root);
  if (drop) wireDropZone(drop, files => uploadToAccount(files), { filesOnly: true });

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
