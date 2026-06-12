/* 总览：待办导向的工作台首页 */

import { esc, gradFor, timeAgo } from "../core/util.js";
import { icon, agentAvatar } from "../ui/icons.js";
import { state, save, productionById, accountById } from "../core/store.js";
import { platChip, groupOf } from "../domain/accounts.js";
import { STAGES, statusPill } from "../domain/productions.js";
import { deliveredAssets } from "../domain/delivery.js";
import { activeBatches, batchProds } from "../agent/orchestrator.js";
import { openProductionDrawer, stagePage } from "./prodDrawer.js";
import { emptyState } from "../ui/components.js";
import { go } from "../core/router.js";

export const overviewView = {
  render(root) {
    const prods = state.productions;
    const inflight = prods.filter(p => p.stage !== "delivered");
    const waiting = inflight.filter(p => p.stageStatus === "needs_input");
    const rendering = inflight.filter(p => p.stage === "render" && p.stageStatus === "running");
    const inReview = inflight.filter(p => p.stage === "review");
    const failed = inflight.filter(p => p.stageStatus === "failed");
    const monthly = state.accounts.reduce((s, a) => s + (a.monthlyDone || 0), 0);
    const delivered = deliveredAssets();
    const pendingDl = delivered.filter(x => x.asset.status !== "已下载").length;
    const batches = activeBatches();

    const stat = (label, n, sub, zone, accent = "") => `
      <button class="ov-stat card ${accent}" data-ov-go="${zone}">
        <b>${n}</b><span>${label}</span><em>${sub}</em>
      </button>`;

    root.innerHTML = `
      <div class="overview">
        <div class="ov-hero card">
          <div class="ovh-left">
            <div class="eyebrow">Dumate Studio · 内容生产工作台</div>
            <h2>${greeting()}，今天从这里开始</h2>
            <p>${state.accounts.length} 个账号 · ${inflight.length} 条在制 · 本月已交付 ${monthly} 条</p>
          </div>
          <button class="ov-agent-band" data-ov-go="agent">
            <span class="oab-glow"></span>
            <span class="oab-avatar">${agentAvatar(40)}</span>
            <span class="oab-text"><b>Agent 工作台</b><em>${batches.length ? `${batches.length} 个批次进行中 · ${batchSummary(batches)}` : "一句话量产一批内容 · 全程自动推进"}</em></span>
            <span class="oab-go">进入 ${icon("arrowRight", 14)}</span>
          </button>
        </div>

        <div class="ov-stats">
          ${stat("等待回传", waiting.length, "站外出图后拖回即可", "agent", waiting.length ? "warn" : "")}
          ${stat("渲染中", rendering.length, "模拟引擎 · 实时进度", "agent", rendering.length ? "run" : "")}
          ${stat("待审核", inReview.length, "人工确认后交付", "agent", inReview.length ? "review" : "")}
          ${stat("失败待重试", failed.length, "一键重试", "agent", failed.length ? "fail" : "")}
          ${stat("供应商待下载", pendingDl, "交付中心可批量下载", "delivery", "")}
        </div>

        <div class="ov-cols">
          <section class="card ov-todo">
            <div class="card-head"><b>待你处理</b><em>${waiting.length + inReview.length + failed.length} 项</em></div>
            ${(waiting.length + inReview.length + failed.length) ? `
            <div class="ov-todo-list">
              ${[...inReview, ...waiting, ...failed].slice(0, 8).map(p => {
                const acc = accountById(p.accountId);
                const [label, cls] = statusPill(p);
                return `<button class="ovt-row" data-prod="${p.id}">
                  <span class="dot" style="background:${gradFor(acc?.name || "")}"></span>
                  <span class="ovt-main"><b>${esc(p.artifacts.copy.title || p.title || p.topic || "未命名")}</b><em>${esc(acc?.name || "")} · ${STAGES[p.stage].label}</em></span>
                  <span class="status-pill ${cls}">${label}</span>
                </button>`;
              }).join("")}
            </div>` : emptyState("checkCircle", "没有待办", "需要人工介入的任务会出现在这里")}
          </section>

          <section class="card ov-recent">
            <div class="card-head"><b>最新交付</b><button class="link-btn" data-ov-go="delivery">交付中心 ${icon("arrowRight", 12)}</button></div>
            ${delivered.length ? `<div class="ov-recent-list">
              ${delivered.slice(0, 6).map(({ asset, acc }) => `
                <div class="ovr-row" ${asset.productionId ? `data-prod="${asset.productionId}"` : ""}>
                  <span class="ovr-cover" style="background:${gradFor(asset.name)}">${asset.type === "图集" ? icon("image", 14) : icon("play", 14)}</span>
                  <span class="ovt-main"><b>${esc(asset.title || asset.name)}</b><em>${esc(acc.name)} · ${esc(asset.name)}</em></span>
                  ${platChip(acc.platform, true)}
                  <time>${timeAgo(asset.createdAt)}</time>
                </div>`).join("")}
            </div>` : emptyState("package", "还没有交付记录", "完成创作并审核交付后会汇总在这里")}
          </section>
        </div>

        <section class="card ov-accounts">
          <div class="card-head"><b>账号矩阵</b><div class="head-actions"><button class="link-btn" id="ovNewAcc">${icon("plus", 12)} 新建账号</button><button class="link-btn" data-ov-go="studio">创作空间 ${icon("arrowRight", 12)}</button></div></div>
          <div class="ov-acc-grid">
            ${state.accounts.map(a => `
              <button class="ov-acc" data-acc="${a.id}">
                <span class="ova-avatar" style="background:${gradFor(a.name)}">${esc(a.name[0])}</span>
                <span class="ovt-main"><b>${esc(a.name)}</b><em>${groupOf(a)} · 本月 ${a.monthlyDone || 0} 条</em></span>
                ${platChip(a.platform, true)}
              </button>`).join("")}
          </div>
        </section>
      </div>`;

    root.querySelectorAll("[data-ov-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.ovGo)));
    root.querySelectorAll("[data-prod]").forEach(b => b.addEventListener("click", () => openProductionDrawer(b.dataset.prod)));
    root.querySelectorAll("[data-acc]").forEach(b => b.addEventListener("click", () => {
      state.ui.activeAccountId = b.dataset.acc; save("meta");
      go("studio");
    }));
    const na = root.querySelector("#ovNewAcc");
    if (na) na.addEventListener("click", () => document.dispatchEvent(new CustomEvent("open-account-dialog", { detail: {} })));
  }
};

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "夜深了" : h < 12 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}
function batchSummary(batches) {
  const all = batches.flatMap(b => batchProds(b));
  const wait = all.filter(p => p.stageStatus === "needs_input").length;
  const review = all.filter(p => p.stage === "review").length;
  if (wait) return `${wait} 条等待回传`;
  if (review) return `${review} 条待审核`;
  return "自动推进中";
}
