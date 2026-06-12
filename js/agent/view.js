/* Agent 工作台：独立沉浸式三栏工作区
   会话列表 | 对话流（结构化卡片） | 任务看板（流水线可视化） */

import { $, $$, esc, copyText, wireDropZone, timeAgo } from "../core/util.js";
import { icon, agentAvatar, brandMark } from "../ui/icons.js";
import { state, save, on, productionById } from "../core/store.js";
import { toast, confirmModal } from "../ui/components.js";
import {
  ensureSession, newSession, addMsg, handleUserText, routeMediaFiles,
  batchById, batchProds, activeBatches, matchAccounts, startBatch,
  startGeneration, approveAll, deliverAll, retryFailedIn
} from "./orchestrator.js";
import { renderMessage, boardRow } from "./cards.js";
import { openProductionDrawer, approveProduction, rejectFlow } from "../views/prodDrawer.js";
import { deliver } from "../domain/delivery.js";
import { go } from "../core/router.js";

let mounted = false;
let rootEl = null;
let thinking = false;

const QUICK_ACTIONS = [
  { t: "发起量产", text: "给所有职场效率标签的账号做一期「下班前自动生成日报」，偏教程风" },
  { t: "查看状态", text: "现在进度怎么样了" },
  { t: "全部生成", text: "开始全部生成" },
  { t: "全部交付", text: "全部交付" }
];

export const agentView = {
  render(root) {
    rootEl = root;
    const s = ensureSession();
    root.innerHTML = `
      <div class="agent-shell">
        <div class="agw-bg"><i></i><i></i><i></i></div>

        <header class="agw-top">
          <button class="agw-back" data-agw="exit">${icon("arrowLeft", 15)} 退出工作台</button>
          <div class="agw-brand">${brandMark(22)}<b>Agent 工作台</b><span class="agw-tag">总调度</span></div>
          <div class="agw-phase" id="agwPhase"></div>
          <div class="agw-top-right">
            <label class="agw-auto" title="开启后：回传齐自动渲染、渲染完自动进审核">
              <input type="checkbox" id="agwAuto" ${state.ui.autoAdvance !== false ? "checked" : ""} />
              <i></i><span>自动推进</span>
            </label>
            <button class="agw-board-toggle" data-agw="board">${icon("kanban", 15)} 看板</button>
          </div>
        </header>

        <div class="agw-body">
          <aside class="agw-sessions" id="agwSessions"></aside>

          <main class="agw-conv">
            <div class="agw-msgs" id="agwMsgs"></div>
            <div class="agw-composer" id="agwComposer">
              <div class="agc-quick" id="agwQuick">${QUICK_ACTIONS.map((q, i) => `<button class="chip" data-quick="${i}">${esc(q.t)}</button>`).join("")}</div>
              <div class="agw-input-card">
                <textarea id="agwInput" rows="1" placeholder="一句话下达目标，或直接拖图回传…（Enter 发送 / Shift+Enter 换行）"></textarea>
                <div class="agw-input-tools">
                  <label class="icon-btn ghost" title="上传回传图片">
                    ${icon("upload", 16)}<input type="file" accept="image/*,video/*" multiple hidden id="agwUpload" />
                  </label>
                  <button class="agw-send" id="agwSend" title="发送">${icon("send", 16)}</button>
                </div>
              </div>
            </div>
          </main>

          <aside class="agw-board" id="agwBoard"></aside>
        </div>
      </div>`;

    renderSessions();
    renderMsgs(true);
    renderBoard();
    renderPhase();
    wire(root);

    if (!mounted) {
      mounted = true;
      on("agent:msg", () => isLive() && (renderMsgs(true), renderSessions()));
      on("agent:session", () => isLive() && (renderSessions(), renderMsgs(true)));
      on("agent:thinking", v => { thinking = v; isLive() && renderThinking(); });
      on("batch:update", () => isLive() && (refreshLiveCards(), renderBoard(), renderPhase()));
      on("job:update", () => isLive() && (renderBoard(), renderPhase()));
      on("production:update", () => isLive() && (refreshLiveCards(), renderBoard(), renderPhase()));
      on("change", () => isLive() && renderPhase());
    }
  }
};

const isLive = () => document.body.dataset.zone === "agent" && rootEl && rootEl.isConnected;

/* ---------- 子区渲染 ---------- */
function renderSessions() {
  const el = $("#agwSessions"); if (!el) return;
  el.innerHTML = `
    <button class="agw-new" data-agw="new-session">${icon("plus", 14)} 新会话</button>
    <div class="agw-slist">${state.sessions.map(s => {
      const last = s.messages[s.messages.length - 1];
      const hasActive = state.batches.some(b => b.sessionId === s.id && b.phase !== "done");
      return `<button class="agw-sitem ${s.id === state.ui.activeSessionId ? "is-active" : ""}" data-session="${s.id}">
        <b>${esc(s.title)}</b>
        <em>${last ? esc(textOf(last)).slice(0, 26) : "空会话"}</em>
        <span class="agw-stime">${hasActive ? `<i class="live-dot"></i>` : ""}${timeAgo(s.createdAt)}</span>
      </button>`;
    }).join("")}</div>`;
}

function textOf(m) {
  if (m.type === "text") return m.payload.text || "";
  return { plan: "📋 量产计划", progress: "⏱ 批次进度", need_input: "📥 等待回传", approval: "👁 审核请求", results: "✅ 批次完成", error: "⚠ 失败报告" }[m.type] || "";
}

function renderMsgs(scroll = false) {
  const el = $("#agwMsgs"); if (!el) return;
  const s = ensureSession();
  if (!s.messages.length) {
    el.innerHTML = `
      <div class="agw-hero">
        <span class="agw-hero-avatar">${agentAvatar(56)}</span>
        <h2>把一批内容交给我</h2>
        <p>一句话下达目标，我来：<b>选号 → 批量起草 → 盯回传 → 渲染 → 智能剪辑 → 请你审核 → 交付入库</b>。<br/>中途关页面也没关系，回来我会接着推进。</p>
        <div class="agw-hero-sugs">
          ${["给所有职场效率账号做一期「下班前自动生成日报」，偏教程风",
             "给图文组来一批「把乱文件夹一键归类」，小红书种草风",
             "创建2个图文号：效率小课堂 定位办公技巧；学生党搭子 定位学生效率"]
          .map(t => `<button class="agw-sug" data-sug="${esc(t)}">${esc(t)} ${icon("arrowRight", 13)}</button>`).join("")}
        </div>
      </div>`;
    return;
  }
  el.innerHTML = s.messages.map(renderMessage).join("") + `<div id="agwThinking"></div>`;
  renderThinking();
  if (scroll) el.scrollTop = el.scrollHeight;
}

function renderThinking() {
  const t = $("#agwThinking"); if (!t) return;
  t.innerHTML = thinking ? `<div class="ag-row agent"><span class="ag-avatar">${agentAvatar(30)}</span><div class="ag-bubble agent typing"><i></i><i></i><i></i></div></div>` : "";
  if (thinking) { const el = $("#agwMsgs"); el.scrollTop = el.scrollHeight; }
}

/* 活卡片就地刷新（不打断滚动/输入） */
function refreshLiveCards() {
  const s = ensureSession();
  $$('#agwMsgs [data-mid]').forEach(node => {
    if (!node.querySelector("[data-live]") && node.dataset.mtype !== "approval" && node.dataset.mtype !== "need_input") return;
    const m = s.messages.find(x => x.id === node.dataset.mid);
    if (!m) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = renderMessage(m);
    node.replaceWith(tmp.firstElementChild);
  });
  wireDrops();
}

function renderBoard() {
  const el = $("#agwBoard"); if (!el) return;
  const bs = activeBatches();
  const doneRecent = state.batches.filter(b => b.phase === "done").slice(-1);
  const groups = [...bs, ...(!bs.length ? doneRecent : [])];
  if (!groups.length) {
    el.innerHTML = `<div class="agw-board-head"><b>任务看板</b></div>
      <div class="agw-board-empty">${icon("kanban", 22)}<p>发起一批量产后，每条任务的流水线会出现在这里：阶段圆点实时点亮，点任务可看详情、拖图可直接回传。</p></div>`;
    return;
  }
  el.innerHTML = `<div class="agw-board-head"><b>任务看板</b><em>${groups.reduce((s, b) => s + (b.productionIds || []).length, 0)} 条任务</em></div>` +
    groups.map(b => {
      const prods = batchProds(b);
      const done = prods.filter(p => p.stage === "delivered").length;
      return `<div class="mb-group">
        <div class="mb-ghead"><b>${esc(b.topic)}</b><span>${done}/${prods.length}</span></div>
        ${prods.map(boardRow).join("")}
      </div>`;
    }).join("");
  // 看板行拖拽回传
  $$("#agwBoard [data-dropprod]").forEach(row => {
    wireDropZone(row, async files => {
      const p = productionById(row.dataset.dropprod);
      if (!p) return;
      const r = await routeFilesToProduction(p, files);
      if (r) toast(`已回传 ${r} 张到「${p.title || p.topic}」`);
    });
  });
}

async function routeFilesToProduction(p, files) {
  const { fileToDataUrl } = await import("../core/util.js");
  const { addAssetFromDataUrl } = await import("../domain/assets.js");
  const { maybeAdvanceAfterInput } = await import("./orchestrator.js");
  const isImg = p.mode === "图文";
  const items = isImg ? p.artifacts.images.items : p.artifacts.boards.items;
  let n = 0;
  for (const f of Array.from(files).filter(x => x.type.startsWith("image/"))) {
    const i = items.findIndex(x => !x.assetId);
    if (i < 0) break;
    const dataUrl = await fileToDataUrl(f);
    const a = await addAssetFromDataUrl(p.accountId, { name: `${isImg ? "笔记图" : "分镜图"}${String(i + 1).padStart(2, "0")}_${(p.title || "").slice(0, 6)}`, tags: [isImg ? "笔记图" : "分镜图", "Agent回传"], dataUrl });
    items[i].assetId = a.id; items[i].status = "done"; n++;
  }
  if (n) {
    save("productions");
    if (items.every(x => x.assetId)) maybeAdvanceAfterInput(p);
  }
  return n;
}

function renderPhase() {
  const el = $("#agwPhase"); if (!el) return;
  const bs = activeBatches();
  if (!bs.length) { el.innerHTML = `<span class="agw-idle">空闲 · 等待新目标</span>`; return; }
  const c = { draft: 0, wait: 0, gen: 0, review: 0, done: 0, fail: 0 };
  bs.forEach(b => batchProds(b).forEach(p => {
    if (p.stageStatus === "failed") c.fail++;
    else if (p.stage === "delivered") c.done++;
    else if (p.stage === "review") c.review++;
    else if (p.stage === "render") c.gen++;
    else if (p.stageStatus === "needs_input") c.wait++;
    else c.draft++;
  }));
  const chip = (label, n, cls) => n ? `<span class="phase-chip ${cls}">${label} ${n}</span>` : "";
  el.innerHTML = chip("起草", c.draft, "draft") + chip("待回传", c.wait, "wait") + chip("渲染", c.gen, "gen") + chip("待审", c.review, "review") + chip("失败", c.fail, "fail") + chip("已交付", c.done, "done");
}

/* ---------- 事件 ---------- */
function wire(root) {
  const input = $("#agwInput", root);
  const fit = () => { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; };
  input.addEventListener("input", fit);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("paste", async e => {
    const items = Array.from(e.clipboardData.items).filter(i => i.type.startsWith("image/"));
    if (items.length) {
      e.preventDefault();
      const r = await routeMediaFiles(items.map(i => i.getAsFile()));
      reportRoute(r);
    }
  });
  $("#agwSend", root).addEventListener("click", send);
  $("#agwUpload", root).addEventListener("change", async e => {
    const r = await routeMediaFiles(e.target.files);
    reportRoute(r);
    e.target.value = "";
  });

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; fit();
    await handleUserText(text);
  }

  // composer 整体可拖图
  wireDropZone($("#agwComposer", root), async files => {
    const r = await routeMediaFiles(files);
    reportRoute(r);
  });

  $("#agwAuto", root).addEventListener("change", e => {
    state.ui.autoAdvance = e.target.checked;
    activeBatches().forEach(b => { b.autoAdvance = e.target.checked; });
    save("meta", "batches");
    toast(e.target.checked ? "已开启自动推进：回传齐自动渲染、完成自动进审核" : "已关闭自动推进：每个关口都会等你确认");
  });

  // 全局委托
  root.addEventListener("click", async e => {
    const exit = e.target.closest('[data-agw="exit"]');
    if (exit) { go("overview"); return; }
    if (e.target.closest('[data-agw="new-session"]')) { newSession(); return; }
    if (e.target.closest('[data-agw="board"]')) { root.querySelector(".agent-shell").classList.toggle("board-hidden"); return; }

    const sess = e.target.closest("[data-session]");
    if (sess) { state.ui.activeSessionId = sess.dataset.session; save("meta"); renderSessions(); renderMsgs(true); return; }

    const sug = e.target.closest("[data-sug]");
    if (sug) { input.value = sug.dataset.sug; fit(); input.focus(); return; }
    const quick = e.target.closest("[data-quick]");
    if (quick) { input.value = QUICK_ACTIONS[+quick.dataset.quick].text; fit(); input.focus(); return; }

    const act = e.target.closest("[data-act]");
    if (!act) return;
    const pid = act.dataset.pid;
    const p = pid ? productionById(pid) : null;
    const batch = act.dataset.batch ? batchById(act.dataset.batch) : null;
    const s = ensureSession();

    switch (act.dataset.act) {
      case "plan-confirm": {
        const m = s.messages.find(x => x.id === act.dataset.mid);
        if (!m || m.payload.status !== "pending") return;
        if (!m.payload.topic.trim()) { toast("先填写主题"); return; }
        if (!m.payload.accountIds.length) { toast("至少选择一个账号"); return; }
        m.payload.status = "confirmed";
        save("sessions");
        renderMsgs(true);
        await startBatch({ ...m.payload, goal: m.payload.goal }, s);
        break;
      }
      case "plan-cancel": {
        const m = s.messages.find(x => x.id === act.dataset.mid);
        if (m) { m.payload.status = "cancelled"; save("sessions"); renderMsgs(); }
        break;
      }
      case "copy-external": {
        if (!p) return;
        const txt = p.mode === "图文" ? p.artifacts.images.externalPrompt : p.artifacts.boards.externalPrompt;
        copyText(txt || "", "已复制整段提示词，去第三方模型粘贴即可");
        break;
      }
      case "open-prod": if (p) openProductionDrawer(p.id); break;
      case "batch-generate": if (batch) { const n = startGeneration(batch); toast(n ? `已派发 ${n} 个渲染任务` : "没有就绪任务"); } break;
      case "batch-retry": if (batch) { const n = retryFailedIn(batch); toast(n ? `正在重试 ${n} 个失败任务` : "没有失败任务"); } break;
      case "batch-approve-all": if (batch) { const n = approveAll(batch); toast(`已通过 ${n} 条`); refreshLiveCards(); } break;
      case "batch-deliver-all": {
        if (!batch) break;
        const cnt = batchProds(batch).filter(x => x.stage === "review").length;
        const ok = await confirmModal({ title: `交付本批 ${cnt} 条内容？`, body: "未通过的会先自动通过审核，全部定稿入交付中心，供应商端可见。", okText: "全部交付" });
        if (ok) { approveAll(batch); const n = deliverAll(batch); toast(`已交付 ${n} 条入库`); }
        break;
      }
      case "prod-approve": if (p) { approveProduction(p); refreshLiveCards(); } break;
      case "prod-reject": if (p) { await rejectFlow(p); refreshLiveCards(); } break;
      case "prod-deliver": {
        if (!p) break;
        const ok = await confirmModal({ title: `交付「${p.artifacts.copy.title || p.title}」？`, body: "定稿入交付中心，供应商端可见可下载。", okText: "交付入库" });
        if (ok) { deliver(p); toast("已交付入库"); }
        break;
      }
    }
  });

  // 需输入卡的文件选择
  root.addEventListener("change", async e => {
    const inp = e.target.closest("[data-agdrop-input]");
    if (inp && inp.files.length) {
      const r = await routeMediaFiles(inp.files);
      reportRoute(r);
      inp.value = "";
    }
  });

  // 计划卡编辑
  root.addEventListener("input", e => {
    const f = e.target.closest("[data-pf]");
    if (!f) return;
    const node = e.target.closest("[data-plan]");
    const s = ensureSession();
    const m = s.messages.find(x => x.id === node.dataset.plan);
    if (m) { m.payload[f.dataset.pf] = f.value; save("sessions"); }
  });
  root.addEventListener("click", e => {
    const tagBtn = e.target.closest("[data-ptag]");
    const accBtn = e.target.closest("[data-pacc]");
    if (!tagBtn && !accBtn) return;
    const node = e.target.closest("[data-plan]");
    if (!node) return;
    const s = ensureSession();
    const m = s.messages.find(x => x.id === node.dataset.plan);
    if (!m || m.payload.status !== "pending") return;
    if (tagBtn) {
      const t = tagBtn.dataset.ptag;
      const i = m.payload.tags.indexOf(t);
      i >= 0 ? m.payload.tags.splice(i, 1) : m.payload.tags.push(t);
      m.payload.accountIds = matchAccounts(m.payload).map(a => a.id);
    } else {
      const id = accBtn.dataset.pacc;
      const i = m.payload.accountIds.indexOf(id);
      i >= 0 ? m.payload.accountIds.splice(i, 1) : m.payload.accountIds.push(id);
    }
    save("sessions");
    const tmp = document.createElement("div");
    tmp.innerHTML = renderMessage(m);
    node.closest("[data-mid]").replaceWith(tmp.firstElementChild);
    wireDrops();
  });

  wireDrops();
}

function wireDrops() {
  $$("#agwMsgs [data-agdrop]").forEach(z => {
    if (z.dataset.wired) return;
    z.dataset.wired = "1";
    wireDropZone(z, async files => {
      const r = await routeMediaFiles(files);
      reportRoute(r);
    });
    z.addEventListener("click", () => { const inp = z.querySelector("[data-agdrop-input]"); if (inp) inp.click(); });
  });
}

function reportRoute(r) {
  if (!r) return;
  if (r.assigned) toast(`已接收 ${r.assigned} 张图，分发到 ${r.tasks} 个任务${r.extra ? `（多出 ${r.extra} 张未分发）` : ""}`);
  else if (r.videos) toast(`已登记 ${r.videos} 个视频素材入资产库`);
  else toast("当前没有等待回传的任务，先发起一批量产");
}
