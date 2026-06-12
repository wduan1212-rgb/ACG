/* 批次编排器：事件驱动的状态机（替代 v4 的 setInterval 盯进度）
   会话/消息/批次全部持久化，刷新后 resumeActiveBatches() 接续 */

import { state, save, emit, on, notify, accountById, productionById } from "../core/store.js";
import { uid, runPool, debounce } from "../core/util.js";
import { AI } from "../api/ai.js";
import { buildSbExternalPrompt, buildImgExternalPrompt } from "../api/prompts.js";
import { groupOf, tagsOf, TAG_POOL, createAccount } from "../domain/accounts.js";
import { createProduction, setStage, setStatus, normalizeVideoTimes, segmentsForGen, autoAssemble, jobsOf } from "../domain/productions.js";
import { createRenderJobsFor, retryJob } from "../api/jobs.js";
import { deliver } from "../domain/delivery.js";
import { addAssetFromDataUrl, addAssetFromFile } from "../domain/assets.js";
import { routeIntent, parseGoalFallback } from "./intent.js";
import { fileToDataUrl } from "../core/util.js";

/* ---------- 会话 ---------- */
export function ensureSession() {
  let s = state.sessions.find(x => x.id === state.ui.activeSessionId);
  if (!s) s = state.sessions[0];
  if (!s) s = newSession();
  state.ui.activeSessionId = s.id;
  return s;
}
export function newSession() {
  const s = { id: uid(), title: "新会话", createdAt: Date.now(), messages: [] };
  state.sessions.unshift(s);
  state.ui.activeSessionId = s.id;
  save("sessions", "meta");
  emit("agent:session");
  return s;
}
export function addMsg(session, msg) {
  const m = { id: uid(), ts: Date.now(), ...msg };
  session.messages.push(m);
  if (session.title === "新会话" && msg.role === "user" && msg.type === "text") {
    session.title = (msg.payload.text || "").slice(0, 18) || "新会话";
  }
  save("sessions");
  emit("agent:msg", m);
  return m;
}
export function agentSay(text, extra = {}) {
  return addMsg(ensureSession(), { role: "agent", type: "text", payload: { text }, ...extra });
}

/* ---------- 批次 ---------- */
export function createBatch(plan, sessionId) {
  const batch = {
    id: uid(), sessionId,
    goal: plan.goal || "", topic: plan.topic, style: plan.style || "",
    tags: plan.tags || [], group: plan.group || "all",
    accountIds: plan.accountIds || [],
    productionIds: [],
    phase: "drafting",         // drafting | awaiting_input | generating | review | done
    autoAdvance: state.ui.autoAdvance !== false,
    createdAt: Date.now(), updatedAt: Date.now()
  };
  state.batches.push(batch);
  save("batches");
  return batch;
}
export const batchById = id => state.batches.find(b => b.id === id);
export const batchProds = b => (b.productionIds || []).map(productionById).filter(Boolean);
export const activeBatches = () => state.batches.filter(b => b.phase !== "done");

export function matchAccounts({ tags = [], group = "all" }) {
  return state.accounts.filter(a =>
    (group === "all" || !group || groupOf(a) === group) &&
    (!tags.length || tags.some(t => tagsOf(a).includes(t))));
}

/* ---------- 起草 ---------- */
async function draftOne(p, batch) {
  const acc = accountById(p.accountId);
  if (!acc) { setStatus(p, "failed", "账号不存在"); return; }
  const isImg = p.mode === "图文";
  try {
    setStatus(p, "running");
    const sres = await AI.generateScript({
      topic: batch.topic + (batch.style ? `（风格策略：${batch.style}）` : ""),
      duration: isImg ? 0 : 30, account: acc, image: isImg, style: isImg ? batch.style : "", imageCount: 6
    });
    p.artifacts.script.shots = sres.shots || [];
    p.artifacts.script.title = sres.title || batch.topic;
    p.artifacts.script.source = AI.lastSource;
    p.artifacts.script.style = batch.style || "";
    p.title = sres.title || batch.topic;
    if (!isImg) normalizeVideoTimes(p.artifacts.script.shots);

    if (isImg) {
      p.artifacts.images.items = p.artifacts.script.shots.map((s, i) => ({
        title: s.idea || `图${i + 1}`, visual: s.visual || "", prompt: "", assetId: null, status: "idle"
      }));
      p.artifacts.images.externalPrompt = buildImgExternalPrompt({
        topic: batch.topic, position: acc.position, shots: p.artifacts.script.shots, style: batch.style
      });
    } else {
      const pres = await AI.generatePrompts({ shots: p.artifacts.script.shots, duration: 30, account: acc });
      p.artifacts.prompts = pres.prompts || [];
      p.artifacts.boards.items = p.artifacts.script.shots.map((s, i) => ({
        title: s.idea || `分镜${i + 1}`, visual: s.visual || "", prompt: "", assetId: null, status: "idle"
      }));
      p.artifacts.boards.externalPrompt = buildSbExternalPrompt({
        shots: p.artifacts.script.shots, style: batch.style
      });
    }
    const cp = await AI.generateCopy({ topic: batch.topic, shots: p.artifacts.script.shots, account: acc, style: batch.style, kind: isImg ? "image" : "video" });
    p.artifacts.copy = { title: cp.title || p.title, body: cp.copy || "" };
    setStage(p, isImg ? "images" : "boards", "needs_input");
  } catch (e) {
    setStatus(p, "failed", "起草失败：" + (e.message || e));
  }
}

export async function startBatch(plan, session) {
  const accounts = plan.accountIds.map(accountById).filter(Boolean);
  if (!accounts.length) { agentSay("⚠ 没有可用账号，先调整计划或创建账号。"); return null; }
  const batch = createBatch(plan, session.id);
  accounts.forEach(acc => {
    const p = createProduction({ accountId: acc.id, topic: plan.topic, origin: "agent", batchId: batch.id, style: plan.style });
    if (p) batch.productionIds.push(p.id);
  });
  save("batches", "productions");
  addMsg(session, { role: "agent", type: "progress", payload: { batchId: batch.id } });
  notify("agent", `批次启动：「${plan.topic}」`, `${accounts.length} 个账号并行起草`);
  runPool(batchProds(batch), p => draftOne(p, batch), 2).then(() => evaluate(batch.id));
  return batch;
}

/* ---------- 回传完成后的推进 ---------- */
export function maybeAdvanceAfterInput(p) {
  const isImg = p.mode === "图文";
  const items = isImg ? p.artifacts.images.items : p.artifacts.boards.items;
  if (!items.length || !items.every(x => x.assetId)) return false;
  if (isImg) {
    // 图文：成图齐 → 文案已有则直接进审核，否则先去文案页
    setStage(p, (p.artifacts.copy.body || "").trim() ? "review" : "copy", "pending");
  } else {
    // 视频：分镜齐 → 渲染就绪
    setStage(p, "render", "pending");
  }
  return true;
}

/* ---------- 渲染 ---------- */
export function startGeneration(batch) {
  const prods = batchProds(batch).filter(p => p.mode === "视频" && p.stage === "render" && p.stageStatus !== "running");
  let jobs = 0;
  prods.forEach(p => {
    const segs = segmentsForGen(p);
    if (!segs.length) { setStatus(p, "failed", "没有可用的提示词"); return; }
    createRenderJobsFor(p, segs);
    setStatus(p, "running");
    jobs += segs.length;
  });
  if (jobs) {
    batch.phase = "generating"; batch.updatedAt = Date.now();
    save("batches");
    emit("batch:update", batch);
  }
  return jobs;
}

/* ---------- 审核 / 交付 ---------- */
export function approveAll(batch) {
  let n = 0;
  batchProds(batch).forEach(p => {
    if (p.stage === "review" && p.review.state !== "approved") { p.review.state = "approved"; p.review.at = Date.now(); n++; }
  });
  save("productions");
  emit("batch:update", batch);
  return n;
}
export function deliverAll(batch) {
  let n = 0;
  batchProds(batch).forEach(p => {
    if (p.stage === "review" && p.review.state === "approved") { if (deliver(p)) n++; }
  });
  evaluate(batch.id);
  return n;
}
export function retryFailedIn(batch) {
  let n = 0;
  batchProds(batch).forEach(p => {
    if (p.stageStatus !== "failed") {
      // 渲染中的失败 job 也重试
      if (p.stage === "render") jobsOf(p).filter(j => j.status === "failed").forEach(j => { retryJob(j.id); setStatus(p, "running"); n++; });
      return;
    }
    if (p.stage === "script") { setStatus(p, "pending"); draftOne(p, batch).then(() => evaluate(batch.id)); n++; }
    else if (p.stage === "render") {
      jobsOf(p).filter(j => j.status === "failed").forEach(j => retryJob(j.id));
      setStatus(p, "running"); n++;
    } else { setStatus(p, "pending"); n++; }
  });
  if (n && batch.phase === "review") { batch.phase = "generating"; save("batches"); }
  return n;
}

/* ---------- 阶段评估（事件驱动核心） ---------- */
const lastEmitted = new Map(); // batchId -> phase 已发卡片去重

export function evaluate(batchId) {
  const batch = batchById(batchId);
  if (!batch || batch.phase === "done") return;
  const prods = batchProds(batch);
  if (!prods.length) return;
  const session = state.sessions.find(s => s.id === batch.sessionId) || ensureSession();

  const drafting = prods.filter(p => p.stage === "script" && p.stageStatus !== "failed").length;
  const failed = prods.filter(p => p.stageStatus === "failed").length;
  const waiting = prods.filter(p => p.stageStatus === "needs_input").length;
  const renderPending = prods.filter(p => p.mode === "视频" && p.stage === "render" && p.stageStatus !== "running").length;
  const rendering = prods.filter(p => p.stage === "render" && p.stageStatus === "running");
  const inReview = prods.filter(p => p.stage === "review").length;
  const delivered = prods.filter(p => p.stage === "delivered").length;

  // 渲染完成检测：所有 job 成功 → 智能剪辑 → 进审核
  rendering.forEach(p => {
    const jobs = jobsOf(p);
    if (!jobs.length) return;
    const allOk = jobs.every(j => j.status === "succeeded");
    const anyFail = jobs.some(j => j.status === "failed");
    const active = jobs.some(j => ["queued", "submitted", "running"].includes(j.status));
    if (allOk) {
      const r = autoAssemble(p);
      setStage(p, "review", "pending");
      notify("agent", `「${p.title || p.topic}」渲染完成`, `已智能拼接 ${r.clips} 段 + ${r.subs} 条字幕，进入待审核`);
    } else if (anyFail && !active) {
      setStatus(p, "failed", jobs.find(j => j.status === "failed")?.error || "部分片段生成失败");
    }
  });

  const key = (ph) => `${batch.id}:${ph}`;
  const emitOnce = (ph, fn) => { if (lastEmitted.get(batch.id) !== ph) { lastEmitted.set(batch.id, ph); fn(); } };

  if (drafting > 0) { batch.phase = "drafting"; }
  else if (waiting > 0) {
    batch.phase = "awaiting_input";
    emitOnce("awaiting_input", () => {
      addMsg(session, { role: "agent", type: "need_input", payload: { batchId: batch.id } });
    });
  } else if (renderPending > 0 || rendering.length > 0) {
    if (renderPending > 0 && batch.autoAdvance) {
      emitOnce("gen_kick", () => agentSay("分镜全部回传完成，自动开始批量生成（并发 2，其余排队）。"));
      startGeneration(batch);
    } else if (renderPending > 0 && !batch.autoAdvance) {
      batch.phase = "awaiting_input";
      emitOnce("gen_wait", () => {
        addMsg(session, { role: "agent", type: "need_input", payload: { batchId: batch.id, mode: "confirm_generate" } });
      });
    } else {
      batch.phase = "generating";
    }
  } else if (inReview > 0 || (failed > 0 && delivered + inReview > 0)) {
    batch.phase = "review";
    emitOnce("review", () => {
      addMsg(session, { role: "agent", type: "approval", payload: { batchId: batch.id } });
      notify("review", `批次「${batch.topic}」待审核`, `${inReview} 条内容等待人工确认`);
    });
  } else if (delivered === prods.length && prods.length > 0) {
    batch.phase = "done";
    emitOnce("done", () => {
      addMsg(session, { role: "agent", type: "results", payload: { batchId: batch.id } });
      notify("agent", `批次「${batch.topic}」全部交付完成`, `${delivered} 条内容已入库`);
    });
  } else if (failed === prods.length) {
    batch.phase = "review";
    emitOnce("allfail", () => addMsg(session, { role: "agent", type: "error", payload: { batchId: batch.id } }));
  }
  batch.updatedAt = Date.now();
  save("batches");
  emit("batch:update", batch);
}

const evaluateAll = debounce(() => activeBatches().forEach(b => evaluate(b.id)), 250);
on("production:update", evaluateAll);
on("job:done", evaluateAll);

/* 启动恢复：把中断的起草接着跑 */
export function resumeActiveBatches() {
  let resumed = 0;
  activeBatches().forEach(b => {
    const stuck = batchProds(b).filter(p => p.stage === "script" && (p.stageStatus === "running" || p.stageStatus === "pending"));
    if (stuck.length) { runPool(stuck, p => draftOne(p, b), 2).then(() => evaluate(b.id)); resumed += stuck.length; }
    evaluate(b.id);
  });
  return resumed;
}

/* ---------- 媒体路由：对话区拖图 → 顺序分发到等待回传的任务 ---------- */
export async function routeMediaFiles(files) {
  const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
  const vids = Array.from(files).filter(f => f.type.startsWith("video/"));
  const out = { assigned: 0, tasks: 0, extra: 0, videos: vids.length };
  if (imgs.length) {
    const targets = state.productions.filter(p => p.stageStatus === "needs_input" &&
      ((p.mode === "图文" ? p.artifacts.images.items : p.artifacts.boards.items) || []).some(x => !x.assetId))
      .sort((a, b) => a.createdAt - b.createdAt);
    let fi = 0;
    for (const p of targets) {
      if (fi >= imgs.length) break;
      const isImg = p.mode === "图文";
      const items = isImg ? p.artifacts.images.items : p.artifacts.boards.items;
      let took = 0;
      for (const item of items) {
        if (fi >= imgs.length) break;
        if (item.assetId) continue;
        const dataUrl = await fileToDataUrl(imgs[fi++]);
        const a = await addAssetFromDataUrl(p.accountId, {
          name: `${isImg ? "笔记图" : "分镜图"}${String(items.indexOf(item) + 1).padStart(2, "0")}_${(p.title || "").slice(0, 6)}`,
          tags: [isImg ? "笔记图" : "分镜图", "Agent回传"], dataUrl
        });
        item.assetId = a.id; item.status = "done";
        took++; out.assigned++;
      }
      if (took) {
        out.tasks++;
        if (items.every(x => x.assetId)) maybeAdvanceAfterInput(p);
        else save("productions");
      }
    }
    out.extra = imgs.length - fi;
  }
  for (const f of vids) {
    const accId = state.productions.find(p => p.batchId)?.accountId || state.accounts[0]?.id;
    if (accId) await addAssetFromFile(accId, f, { tags: ["Agent回传"] });
  }
  evaluateAll();
  return out;
}

/* ---------- 用户输入主入口 ---------- */
export function contextSummary() {
  const bs = activeBatches();
  if (!bs.length) return "无进行中的批次";
  return bs.map(b => {
    const prods = batchProds(b);
    const c = {};
    prods.forEach(p => { const k = p.stage + (p.stageStatus === "failed" ? "(失败)" : ""); c[k] = (c[k] || 0) + 1; });
    return `批次「${b.topic}」阶段:${b.phase}，任务:${Object.entries(c).map(([k, v]) => k + "×" + v).join("、")}`;
  }).join("；");
}

export async function handleUserText(text) {
  const session = ensureSession();
  addMsg(session, { role: "user", type: "text", payload: { text } });
  emit("agent:thinking", true);
  try {
    const r = await routeIntent(text, contextSummary());
    if (r.intent === "create_accounts") {
      const accs = await AI.parseAccountsMd(text);
      let created = 0;
      const names = [];
      accs.forEach(x => {
        if (!x.name || state.accounts.some(a => a.name === x.name)) return;
        createAccount(x); created++; names.push(x.name);
      });
      agentSay(created
        ? `已创建 ${created} 个账号：${names.join("、")}。直接说主题就能给它们安排一批量产。`
        : `没有解析出新账号（重名会跳过）。可以这样描述：「创建2个图文号：A 定位办公技巧；B 定位学生党效率」。`);
      emit("agent:session");
      return;
    }
    if (r.intent === "run_generation") {
      let total = 0;
      activeBatches().forEach(b => { total += startGeneration(b); });
      agentSay(total ? `收到，已派发 ${total} 个生成任务（并发 2，其余排队）。看板可以实时盯进度。` : "当前没有就绪的渲染任务（分镜回传齐了才能生成）。");
      return;
    }
    if (r.intent === "approve_all") {
      let n = 0; activeBatches().forEach(b => n += approveAll(b));
      agentSay(n ? `已通过 ${n} 条审核，说「全部交付」即可入库。` : "没有待审核的内容。");
      return;
    }
    if (r.intent === "deliver_all") {
      let n = 0; activeBatches().forEach(b => n += deliverAll(b));
      agentSay(n ? `已交付 ${n} 条内容：定稿入交付中心，供应商端可见可下载。` : "没有可交付的内容（需要先通过审核）。");
      return;
    }
    if (r.intent === "retry_failed") {
      let n = 0; activeBatches().forEach(b => n += retryFailedIn(b));
      agentSay(n ? `正在重试 ${n} 个失败任务。` : "没有失败任务。");
      return;
    }
    if (r.intent === "status_query") {
      agentSay(statusText());
      return;
    }
    if (r.intent === "plan_batch") {
      const params = r.params.topic ? r.params : parseGoalFallback(text);
      const matched = matchAccounts(params);
      addMsg(session, {
        role: "agent", type: "plan",
        payload: {
          status: "pending", goal: text,
          topic: params.topic, style: params.style || "", tags: params.tags || [], group: params.group || "all",
          accountIds: matched.map(a => a.id)
        }
      });
      return;
    }
    // chat
    try {
      const reply = await AI.chat([
        { role: "system", content: `你是「量产 Agent」，一个内容生产工作台的调度助手。工作台能力：按账号定位批量起草脚本/图卡 → 站外出图回传 → （视频）模拟渲染 → 智能剪辑+字幕 → 人工审核 → 定稿交付。当前状态：${contextSummary()}。用简洁中文回答，不要 markdown 标题，必要时给出下一步建议（如「说出主题即可发起量产」）。` },
        { role: "user", content: text }
      ]);
      agentSay(reply || statusText());
    } catch (e) {
      agentSay(statusText());
    }
  } finally {
    emit("agent:thinking", false);
  }
}

export function statusText() {
  const bs = activeBatches();
  if (!bs.length) {
    const n = state.productions.filter(p => p.stage !== "delivered").length;
    return n ? `当前没有进行中的批次，但有 ${n} 条在制任务散落在创作空间。一句话告诉我主题，我可以发起一批新的量产。` : "一切就绪。说出主题（可带标签/范围/风格），例如：「给所有职场效率账号做一期下班前自动生成日报，偏教程风」。";
  }
  return bs.map(b => {
    const prods = batchProds(b);
    const phase = { drafting: "批量起草中", awaiting_input: "等待分镜回传", generating: "渲染中", review: "待审核", done: "已完成" }[b.phase] || b.phase;
    const fail = prods.filter(p => p.stageStatus === "failed").length;
    const done = prods.filter(p => p.stage === "delivered").length;
    return `「${b.topic}」：${phase} · ${done}/${prods.length} 已交付${fail ? ` · ${fail} 条失败（说"重试失败的"即可）` : ""}`;
  }).join("\n");
}
