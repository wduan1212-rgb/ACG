/* Agent 对话的结构化消息卡片（对话即数据：卡片从 store 实时取数渲染） */

import { esc, gradFor, timeAgo } from "../core/util.js";
import { icon, agentAvatar } from "../ui/icons.js";
import { state, accountById } from "../core/store.js";
import { platChip, groupOf, tagsOf, TAG_POOL } from "../domain/accounts.js";
import { STAGES, flowOf, stageDone, statusPill, jobsOf } from "../domain/productions.js";
import { batchById, batchProds } from "./orchestrator.js";
import { urlFor } from "../domain/assets.js";

export function renderMessage(m) {
  if (m.role === "user") {
    return `<div class="ag-row user" data-mid="${m.id}">
      <div class="ag-bubble user">${esc(m.payload.text)}</div>
    </div>`;
  }
  const inner = CARD[m.type] ? CARD[m.type](m) : CARD.text(m);
  return `<div class="ag-row agent" data-mid="${m.id}" data-mtype="${m.type}">
    <span class="ag-avatar">${agentAvatar(30)}</span>
    <div class="ag-content">${inner}<time class="ag-time">${timeAgo(m.ts)}</time></div>
  </div>`;
}

const CARD = {
  text(m) {
    return `<div class="ag-bubble agent">${esc(m.payload.text).replace(/\n/g, "<br/>")}</div>`;
  },

  /* 计划卡：确认前可改主题/风格/标签/选号 */
  plan(m) {
    const p = m.payload;
    const matched = (p.accountIds || []).map(accountById).filter(Boolean);
    const confirmed = p.status === "confirmed";
    const cancelled = p.status === "cancelled";
    return `<div class="ag-card plan ${confirmed ? "resolved" : ""}" data-plan="${m.id}">
      <div class="agc-head">${icon("kanban", 15)}<b>量产计划</b>
        <span class="agc-state ${confirmed ? "ok" : cancelled ? "off" : ""}">${confirmed ? "已执行" : cancelled ? "已取消" : "待确认"}</span>
      </div>
      <div class="agc-grid">
        <label class="agc-field">主题<input data-pf="topic" value="${esc(p.topic || "")}" ${confirmed || cancelled ? "disabled" : ""} /></label>
        <label class="agc-field">风格策略<input data-pf="style" value="${esc(p.style || "")}" placeholder="可空" ${confirmed || cancelled ? "disabled" : ""} /></label>
      </div>
      <div class="agc-tags">${TAG_POOL.map(t => `<button class="chip ${p.tags.includes(t) ? "on" : ""}" data-ptag="${esc(t)}" ${confirmed || cancelled ? "disabled" : ""}>${esc(t)}</button>`).join("")}</div>
      <div class="agc-sec">命中 ${matched.length} 个账号 <em>点击可增减</em></div>
      <div class="agc-accs">${state.accounts.map(a => {
        const on = (p.accountIds || []).includes(a.id);
        return `<button class="agc-acc ${on ? "on" : ""}" data-pacc="${a.id}" ${confirmed || cancelled ? "disabled" : ""}>
          <span class="dot" style="background:${gradFor(a.name)}"></span>
          <b>${esc(a.name)}</b><em>${groupOf(a)}${tagsOf(a).length ? " · " + tagsOf(a).slice(0, 2).join("/") : ""}</em>
          ${on ? icon("check", 13, "ok") : ""}
        </button>`;
      }).join("")}</div>
      ${confirmed || cancelled ? "" : `<div class="agc-foot">
        <button class="btn ghost sm" data-act="plan-cancel" data-mid="${m.id}">取消</button>
        <button class="btn primary sm" data-act="plan-confirm" data-mid="${m.id}">${icon("spark", 14)} 确认执行（${matched.length} 条）</button>
      </div>`}
    </div>`;
  },

  /* 进度卡：活卡片，从 store 实时取数 */
  progress(m) {
    const b = batchById(m.payload.batchId);
    if (!b) return `<div class="ag-bubble agent">批次已不存在</div>`;
    const prods = batchProds(b);
    const seg = (label, n, cls) => n ? `<span class="agp-seg ${cls}"><b>${n}</b>${label}</span>` : "";
    const c = { draft: 0, wait: 0, gen: 0, review: 0, done: 0, fail: 0 };
    prods.forEach(p => {
      if (p.stageStatus === "failed") c.fail++;
      else if (p.stage === "delivered") c.done++;
      else if (p.stage === "review") c.review++;
      else if (p.stage === "render") c.gen++;
      else if (p.stageStatus === "needs_input") c.wait++;
      else c.draft++;
    });
    const pct = prods.length ? Math.round(c.done / prods.length * 100) : 0;
    const PHASE = { drafting: "批量起草中", awaiting_input: "等待回传", generating: "渲染中", review: "待审核", done: "已完成" };
    return `<div class="ag-card live" data-live="batch" data-batch="${b.id}">
      <div class="agc-head">${icon("pulse", 15)}<b>「${esc(b.topic)}」</b><span class="agc-state run">${PHASE[b.phase] || b.phase}</span></div>
      <div class="agp-bar"><i style="width:${pct}%"></i></div>
      <div class="agp-segs">
        ${seg("起草", c.draft, "draft")}${seg("待回传", c.wait, "wait")}${seg("渲染", c.gen, "gen")}${seg("待审", c.review, "review")}${seg("已交付", c.done, "done")}${seg("失败", c.fail, "fail")}
      </div>
    </div>`;
  },

  /* 等待回传卡：内嵌拖拽热区 + 缺口列表 */
  need_input(m) {
    const b = batchById(m.payload.batchId);
    if (!b) return `<div class="ag-bubble agent">批次已不存在</div>`;
    const prods = batchProds(b);
    if (m.payload.mode === "confirm_generate") {
      const ready = prods.filter(p => p.stage === "render" && p.stageStatus !== "running").length;
      return `<div class="ag-card live" data-live="batch" data-batch="${b.id}">
        <div class="agc-head">${icon("film", 15)}<b>分镜全部就位</b></div>
        <p class="agc-p">自动推进已关闭。${ready} 条视频就绪，确认后开始批量渲染（并发 2）。</p>
        <div class="agc-foot"><button class="btn primary sm" data-act="batch-generate" data-batch="${b.id}">${icon("play", 13)} 开始批量生成</button></div>
      </div>`;
    }
    const waiting = prods.filter(p => p.stageStatus === "needs_input");
    const rows = waiting.map(p => {
      const items = (p.mode === "图文" ? p.artifacts.images.items : p.artifacts.boards.items) || [];
      const got = items.filter(x => x.assetId).length;
      const acc = accountById(p.accountId);
      return `<div class="agn-row">
        <span class="dot" style="background:${gradFor(acc?.name || "")}"></span>
        <b>${esc(acc?.name || "")}</b>
        <span class="agn-bar"><i style="width:${items.length ? got / items.length * 100 : 0}%"></i></span>
        <em>${got}/${items.length}</em>
        <button class="link-btn" data-act="copy-external" data-pid="${p.id}">复制提示词</button>
        <button class="link-btn" data-act="open-prod" data-pid="${p.id}">详情</button>
      </div>`;
    }).join("");
    return `<div class="ag-card live" data-live="batch" data-batch="${b.id}">
      <div class="agc-head">${icon("upload", 15)}<b>等待站外出图回传</b><span class="agc-state wait">${waiting.length} 条任务</span></div>
      <p class="agc-p">复制各任务的整段提示词去第三方模型出图，回来把图<b>直接拖进下面这块区域</b>（或拖到输入框），我会按顺序分发到各任务，全部就位后${b.autoAdvance ? "自动" : "等你确认再"}继续。</p>
      ${rows ? `<div class="agn-list">${rows}</div>` : `<div class="agc-p ok">${icon("checkCircle", 14)} 已全部回传完成</div>`}
      ${waiting.length ? `<div class="ag-drop" data-agdrop="${b.id}">
        <span class="agd-rings"><i></i><i></i></span>
        ${icon("upload", 18)}
        <b>拖图到这里 · 自动按缺口分发</b>
        <em>也可以点击选择（可多选）</em>
        <input type="file" accept="image/*" multiple hidden data-agdrop-input="${b.id}" />
      </div>` : ""}
    </div>`;
  },

  /* 审核卡：逐条通过/驳回 + 批量操作 */
  approval(m) {
    const b = batchById(m.payload.batchId);
    if (!b) return `<div class="ag-bubble agent">批次已不存在</div>`;
    const prods = batchProds(b);
    const inReview = prods.filter(p => p.stage === "review");
    const failed = prods.filter(p => p.stageStatus === "failed");
    const rows = inReview.map(p => {
      const acc = accountById(p.accountId);
      const approved = p.review.state === "approved";
      const items = (p.mode === "图文" ? p.artifacts.images.items : p.artifacts.boards.items) || [];
      const cover = items.find(x => x.assetId);
      const coverUrl = cover ? urlFor(cover.assetId) : null;
      return `<div class="agr-row ${approved ? "ok" : ""}">
        <span class="agr-cover">${coverUrl ? `<img src="${coverUrl}"/>` : `<i style="background:${gradFor(p.title)}">${p.mode === "图文" ? "图" : "片"}</i>`}</span>
        <span class="agr-main"><b>${esc(p.artifacts.copy.title || p.title || p.topic)}</b><em>${esc(acc?.name || "")} · ${p.mode}${p.mode === "视频" ? ` · ${(p.artifacts.timeline || []).length}段` : ` · ${items.length}图`}</em></span>
        ${approved
          ? `<span class="agr-ok">${icon("checkCircle", 14)} 已通过</span><button class="btn primary sm" data-act="prod-deliver" data-pid="${p.id}">交付</button>`
          : `<button class="link-btn" data-act="open-prod" data-pid="${p.id}">查看</button>
             <button class="btn ghost sm" data-act="prod-reject" data-pid="${p.id}">驳回</button>
             <button class="btn primary sm" data-act="prod-approve" data-pid="${p.id}">通过</button>`}
      </div>`;
    }).join("");
    return `<div class="ag-card live" data-live="batch" data-batch="${b.id}">
      <div class="agc-head">${icon("eye", 15)}<b>人工审核</b><span class="agc-state review">${inReview.length} 条待处理</span></div>
      ${rows || `<div class="agc-p ok">${icon("checkCircle", 14)} 本批审核全部处理完毕</div>`}
      ${failed.length ? `<div class="agc-p fail">${icon("alert", 13)} 另有 ${failed.length} 条失败 <button class="link-btn" data-act="batch-retry" data-batch="${b.id}">重试失败项</button></div>` : ""}
      ${inReview.length ? `<div class="agc-foot">
        <button class="btn ghost sm" data-act="batch-approve-all" data-batch="${b.id}">全部通过</button>
        <button class="btn primary sm" data-act="batch-deliver-all" data-batch="${b.id}">${icon("package", 14)} 全部交付入库</button>
      </div>` : ""}
    </div>`;
  },

  /* 结果卡 */
  results(m) {
    const b = batchById(m.payload.batchId);
    if (!b) return `<div class="ag-bubble agent">批次已不存在</div>`;
    const prods = batchProds(b);
    const done = prods.filter(p => p.stage === "delivered");
    return `<div class="ag-card">
      <div class="agc-head">${icon("checkCircle", 15)}<b>批次完成</b><span class="agc-state ok">${done.length}/${prods.length} 已交付</span></div>
      <div class="agres-grid">${done.map(p => {
        const acc = accountById(p.accountId);
        const items = (p.mode === "图文" ? p.artifacts.images.items : p.artifacts.boards.items) || [];
        const cover = items.find(x => x.assetId);
        const u = cover ? urlFor(cover.assetId) : null;
        return `<button class="agres-item" data-act="open-prod" data-pid="${p.id}">
          ${u ? `<img src="${u}"/>` : `<i style="background:${gradFor(p.title)}"></i>`}
          <b>${esc(p.artifacts.copy.title || p.title)}</b><em>${esc(acc?.name || "")} · ${esc(p.delivery?.name || "")}</em>
        </button>`;
      }).join("")}</div>
      <p class="agc-p">交付物已进入交付中心，供应商端可见可下载。</p>
    </div>`;
  },

  /* 错误卡 */
  error(m) {
    const b = batchById(m.payload.batchId);
    const prods = b ? batchProds(b).filter(p => p.stageStatus === "failed") : [];
    return `<div class="ag-card live" data-live="batch" data-batch="${b ? b.id : ""}">
      <div class="agc-head">${icon("alert", 15)}<b>有任务失败</b><span class="agc-state fail">${prods.length} 条</span></div>
      ${prods.map(p => {
        const acc = accountById(p.accountId);
        return `<div class="agn-row"><span class="dot" style="background:${gradFor(acc?.name || "")}"></span><b>${esc(acc?.name || "")}</b><em class="fail-text">${esc(p.error || "未知错误")}</em></div>`;
      }).join("")}
      ${b ? `<div class="agc-foot"><button class="btn primary sm" data-act="batch-retry" data-batch="${b.id}">${icon("refresh", 13)} 重试失败项</button></div>` : ""}
    </div>`;
  }
};

/* 看板任务行（右栏 Mission Board） */
export function boardRow(p) {
  const acc = accountById(p.accountId);
  const flow = flowOf(p.mode);
  const curIdx = flow.indexOf(p.stage);
  const [label, cls] = statusPill(p);
  const dots = flow.map((st, i) => {
    let s = "idle";
    if (p.stage === "delivered" || i < curIdx || (i === curIdx && p.stageStatus === "done") || stageDone(p, st) && i <= curIdx) s = "done";
    if (i === curIdx && p.stage !== "delivered") {
      s = p.stageStatus === "failed" ? "fail" : p.stageStatus === "running" ? "run" : p.stageStatus === "needs_input" ? "wait" : "cur";
    }
    return `<span class="mb-dot ${s}" title="${STAGES[st].label}"><i></i></span>`;
  }).join(`<span class="mb-link"></span>`);
  // 渲染中的细进度
  let sub = "";
  if (p.stage === "render" && p.stageStatus === "running") {
    const jobs = jobsOf(p);
    const ok = jobs.filter(j => j.status === "succeeded").length;
    const run = jobs.find(j => j.status === "running");
    sub = `<span class="mb-sub">渲染 ${ok}/${jobs.length}${run ? ` · ${run.progress}%` : ""}</span>`;
  } else if (p.stageStatus === "needs_input") {
    const items = (p.mode === "图文" ? p.artifacts.images.items : p.artifacts.boards.items) || [];
    sub = `<span class="mb-sub">回传 ${items.filter(x => x.assetId).length}/${items.length}</span>`;
  } else if (p.stageStatus === "failed") {
    sub = `<span class="mb-sub fail-text">${esc((p.error || "失败").slice(0, 18))}</span>`;
  }
  return `<button class="mb-row" data-act="open-prod" data-pid="${p.id}" data-dropprod="${p.id}">
    <div class="mb-top">
      <span class="dot" style="background:${gradFor(acc?.name || "")}"></span>
      <b>${esc(acc?.name || "")}</b>
      ${platChip(acc?.platform || "小红书", true)}
      <span class="status-pill ${cls}">${label}</span>
    </div>
    <div class="mb-title">${esc(p.artifacts.copy.title || p.title || p.topic || "未命名")}</div>
    <div class="mb-dots">${dots}${sub}</div>
  </button>`;
}
