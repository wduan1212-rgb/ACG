/* 批次编排器：事件驱动的状态机（替代 v4 的 setInterval 盯进度）
   会话/消息/批次全部持久化，刷新后 resumeActiveBatches() 接续 */

import { state, save, emit, on, notify, accountById, productionById, ownedBy } from "../core/store.js";
import { uid, runPool, debounce } from "../core/util.js";
import { AI } from "../api/ai.js";
import { buildSbExternalPrompt, buildImgExternalPrompt, buildSbExternalGroups } from "../api/prompts.js";
import { groupOf, tagsOf, TAG_POOL, createAccount } from "../domain/accounts.js";
import { createProduction, setStage, setStatus, normalizeVideoTimes, segmentsForGen, autoAssemble, jobsOf, isMaterial, estimateAudio, buildMaterialUnits } from "../domain/productions.js";
import { createRenderJobsFor, retryJob, createJob } from "../api/jobs.js";
import { deliver } from "../domain/delivery.js";
import { addAssetFromDataUrl, addAssetFromFile } from "../domain/assets.js";
import { routeIntent, parseGoalFallback } from "./intent.js";
import { fileToDataUrl } from "../core/util.js";

/* ---------- 会话 ---------- */
export function ensureSession() {
  let s = state.sessions.find(x => x.id === state.ui.activeSessionId);
  if (!s) s = state.sessions[0];
  if (!s || !ownedBy(s)) s = mySessions()[0] || newSession();
  state.ui.activeSessionId = s.id;
  return s;
}
/* 当前成员名下的会话（每人会话隔离，聊天记录不共享） */
export function mySessions() {
  return state.sessions.filter(ownedBy);
}
export function newSession() {
  // 已有空会话则复用，避免堆积
  const empty = mySessions().find(s => !(s.messages || []).length);
  if (empty) {
    state.ui.activeSessionId = empty.id;
    save("meta");
    emit("agent:session");
    return empty;
  }
  const s = { id: uid(), ownerId: state.ui.currentMemberId || null, title: "新会话", createdAt: Date.now(), messages: [] };
  state.sessions.unshift(s);
  state.ui.activeSessionId = s.id;
  save("sessions", "meta");
  emit("agent:session");
  return s;
}
export function renameSession(id, title) {
  const s = state.sessions.find(x => x.id === id);
  if (s && title) { s.title = title.slice(0, 24); save("sessions"); emit("agent:session"); }
}
export function deleteSession(id) {
  state.sessions = state.sessions.filter(x => x.id !== id);
  if (state.ui.activeSessionId === id) state.ui.activeSessionId = state.sessions[0]?.id || null;
  save("sessions", "meta");
  emit("agent:session");
}
/* 启动清理：历史遗留的空会话只保留最新一个 */
export function pruneEmptySessions() {
  const empties = state.sessions.filter(s => !(s.messages || []).length);
  if (empties.length > 1) {
    const keep = empties[0].id;
    state.sessions = state.sessions.filter(s => (s.messages || []).length || s.id === keep);
    if (!state.sessions.find(s => s.id === state.ui.activeSessionId)) state.ui.activeSessionId = state.sessions[0]?.id || null;
    save("sessions", "meta");
  }
}
/* 某会话下的批次（任务看板按会话独立） */
export function sessionBatches(sessionId) {
  return state.batches.filter(b => b.sessionId === sessionId);
}
/* 删除整批（连同未交付的在制产物与其 job） */
export function deleteBatch(batchId) {
  const b = batchById(batchId); if (!b) return;
  const ids = b.productionIds || [];
  state.productions = state.productions.filter(p => !(ids.includes(p.id) && p.stage !== "delivered"));
  state.jobs = state.jobs.filter(j => !ids.includes(j.productionId) || state.productions.some(p => p.id === j.productionId));
  state.batches = state.batches.filter(x => x.id !== batchId);
  save("productions", "jobs", "batches");
  emit("batch:update", b);
}
/* 从批次里删除单条任务 */
export function removeProductionFromBatch(pid) {
  const p = productionById(pid);
  state.productions = state.productions.filter(x => x.id !== pid);
  state.jobs = state.jobs.filter(j => j.productionId !== pid);
  state.batches.forEach(b => { b.productionIds = (b.productionIds || []).filter(id => id !== pid); });
  save("productions", "jobs", "batches");
  if (p) emit("production:update", p);
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
    ownerId: state.ui.currentMemberId || null,
    goal: plan.goal || "",
    topic: plan.topicMode === "random" ? "每号随机主题" : plan.topic,
    topicMode: plan.topicMode || "fixed",   // fixed | random（每个账号各随机一个主题）
    style: plan.style || "",
    sharedRefAssetId: plan.sharedRefAssetId || null,  // 批量统一参考图（所有账号共用 logo/产品界面）
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

/* 固定流程模板：一键发起规定动作（主题每号随机、风格用账号自带创作风格） */
export const FLOW_TEMPLATES = {
  notes: { label: "全部图文号 · 出一批笔记", group: "图文组", icon: "image", desc: "每号随机主题 · 风格用账号自带 · 站外出图回传" },
  material: { label: "全部素材号 · 全自动出片", group: "素材", icon: "layers", desc: "随机主题 → 口播音频 → 逐镜头视频 → 智能混剪，无需人工回传" },
  dh: { label: "全部真人号 · 出口播视频", group: "真人", icon: "user", desc: "每号随机主题 · 两段式提示词 · 分镜回传后自动渲染" }
};
export function templatePlan(key) {
  const t = FLOW_TEMPLATES[key];
  if (!t) return null;
  const matched = matchAccounts({ tags: [], group: t.group });
  return {
    goal: t.label, topicMode: "random", topic: "", style: "",
    tags: [], group: t.group, accountIds: matched.map(a => a.id), template: key
  };
}
export const batchById = id => state.batches.find(b => b.id === id);
export const batchProds = b => (b.productionIds || []).map(productionById).filter(Boolean);
export const activeBatches = () => state.batches.filter(b => b.phase !== "done" && ownedBy(b));
/* 当前会话的批次（看板按会话独立） */
export const currentSessionBatches = () => sessionBatches(state.ui.activeSessionId).filter(ownedBy);

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
  const material = isMaterial(p);
  try {
    setStatus(p, "running");
    // 主题：批次固定 or 每号随机；风格：账号自带创作风格优先
    let topic = batch.topicMode === "random" ? "" : batch.topic;
    if (!topic) topic = p.topic || await AI.randomPick({ kind: "topic", account: acc });
    p.topic = topic;
    const style = acc.styleProfile || acc.lockedStyle || batch.style || "";

    const sres = material
      ? await AI.generateMaterialScript({ topic, account: acc, style })
      : await AI.generateScript({
        topic: topic + (style ? `（风格策略：${style}）` : ""),
        duration: isImg ? 0 : 30, account: acc, image: isImg, style: isImg ? style : "", imageCount: 6
      });
    p.artifacts.script.shots = sres.shots || [];
    p.artifacts.script.title = sres.title || topic;
    p.artifacts.script.source = AI.lastSource;
    p.artifacts.script.style = style;
    p.title = sres.title || topic;

    if (isImg) {
      p.artifacts.images.items = p.artifacts.script.shots.map((s, i) => ({
        title: s.idea || `图${i + 1}`, visual: s.visual || "", prompt: "", assetId: null, status: "idle"
      }));
      p.artifacts.images.externalPrompt = buildImgExternalPrompt({
        topic, position: acc.position, shots: p.artifacts.script.shots, style
      });
    } else if (material) {
      // 素材号全自动：口播估时 → 按场景合并分镜单元 → 图片提示词(先)+视频提示词(后) → 派发视频任务
      Object.assign(p.artifacts.audio, estimateAudio(p.artifacts.script.shots), { source: "estimate" });
      // 批量统一参考图（所有账号共用 logo/产品界面）
      if (batch.sharedRefAssetId && accountAssetsHas(acc.id, batch.sharedRefAssetId)) p.artifacts.boards.sharedRefAssetId = batch.sharedRefAssetId;
      const units = buildMaterialUnits(p);
      const ures = await AI.generateUnitPrompts({ units, shots: p.artifacts.script.shots, account: acc, style });
      units.forEach((u, i) => { u.imagePrompt = (ures.units[i] || {}).imagePrompt || ""; u.videoPrompt = (ures.units[i] || {}).videoPrompt || ""; });
      p.artifacts.boards.externalGroups = buildSbExternalGroups({ shots: p.artifacts.script.shots, style });
      const cp0 = await AI.generateCopy({ topic, shots: p.artifacts.script.shots, account: acc, style, kind: "video" });
      p.artifacts.copy = { title: cp0.title || p.title, body: cp0.copy || "" };
      setStage(p, "workshop", "running");
      createUnitVideoJobs(p);   // t2v 单元直接生成；i2v 单元无图时也先出片占位，回工坊可补图重生成
      return;
    } else {
      normalizeVideoTimes(p.artifacts.script.shots);
      const pres = await AI.generatePrompts({ shots: p.artifacts.script.shots, duration: 30, account: acc });
      p.artifacts.prompts = pres.prompts || [];
      p.artifacts.boards.items = p.artifacts.script.shots.map((s, i) => ({
        title: s.idea || `分镜${i + 1}`, visual: s.visual || "", prompt: "", assetId: null, status: "idle"
      }));
      p.artifacts.boards.externalPrompt = buildSbExternalPrompt({
        shots: p.artifacts.script.shots, style
      });
    }
    const cp = await AI.generateCopy({ topic, shots: p.artifacts.script.shots, account: acc, style, kind: isImg ? "image" : "video" });
    p.artifacts.copy = { title: cp.title || p.title, body: cp.copy || "" };
    setStage(p, isImg ? "images" : "boards", "needs_input");
  } catch (e) {
    setStatus(p, "failed", "起草失败：" + (e.message || e));
  }
}

function accountAssetsHas(accId, assetId) {
  return state.assets.some(a => a.id === assetId && a.accountId === accId);
}

/* 素材号：按「分镜单元」派发视频任务（i2v 单元带分镜图参考、t2v 单元纯文生视频；已成功的跳过） */
export function createUnitVideoJobs(p, onlyUnitIndex = null) {
  const units = buildMaterialUnits(p); // 重算确保与脚本同步
  const sharedRef = p.artifacts.boards.sharedRefAssetId;
  let n = 0;
  units.forEach((u, i) => {
    if (onlyUnitIndex != null && i !== onlyUnitIndex) return;
    if (onlyUnitIndex == null && state.jobs.some(j => j.productionId === p.id && j.segIndex === i && j.status === "succeeded")) return;
    if (!u.videoPrompt) return;
    const refs = [u.imageAssetId, u.refAssetId, u.needsImage ? sharedRef : null].filter(Boolean);
    createJob({
      kind: "video", productionId: p.id, segIndex: i,
      segName: `场景${String(u.scene).padStart(2, "0")}${u.shotIndexes.length > 1 ? `·${u.shotIndexes.length}镜` : ""}`,
      prompt: u.videoPrompt, refAssetIds: refs,
      ratio: "9:16", duration: Math.min(15, Math.max(2, Math.ceil(u.dur || 4)))
    });
    n++;
  });
  return n;
}
/* 兼容旧调用名 */
export const createShotVideoJobs = createUnitVideoJobs;

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
  // 起草过程播报到思考面板
  emit("agent:thinking", true);
  think(`并发起草 ${accounts.length} 个账号的脚本与提示词…`);
  let drafted = 0;
  const total = accounts.length;
  runPool(batchProds(batch), async p => {
    await draftOne(p, batch);
    drafted++;
    think(`起草完成 ${drafted}/${total} · ${accountById(p.accountId)?.name || ""}`);
  }, 2).then(() => { emit("agent:thinking", false); evaluate(batch.id); });
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
  let jobs = 0;
  batchProds(batch).forEach(p => {
    if (isMaterial(p)) {
      if (p.stage === "workshop" && p.stageStatus !== "running") {
        const n = createUnitVideoJobs(p);
        if (n) { setStatus(p, "running"); jobs += n; }
      }
      return;
    }
    if (p.mode !== "视频" || p.stage !== "render" || p.stageStatus === "running") return;
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
    const jobStage = p.stage === "render" || p.stage === "workshop";
    if (p.stageStatus !== "failed") {
      // 渲染/工坊中的失败 job 也重试
      if (jobStage) jobsOf(p).filter(j => j.status === "failed").forEach(j => { retryJob(j.id); setStatus(p, "running"); n++; });
      return;
    }
    if (p.stage === "script") { setStatus(p, "pending"); draftOne(p, batch).then(() => evaluate(batch.id)); n++; }
    else if (jobStage) {
      const failed = jobsOf(p).filter(j => j.status === "failed");
      if (failed.length) failed.forEach(j => retryJob(j.id));
      else if (p.stage === "workshop") createUnitVideoJobs(p);
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
  const renderPending = prods.filter(p =>
    (p.mode === "视频" && p.stage === "render" && p.stageStatus !== "running") ||
    (p.stage === "workshop" && p.stageStatus !== "running")).length;
  const rendering = prods.filter(p => (p.stage === "render" || p.stage === "workshop") && p.stageStatus === "running");
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
      notify("agent", `「${p.title || p.topic}」渲染完成`, `已智能${isMaterial(p) ? "混剪" : "拼接"} ${r.clips} 段 + ${r.subs} 条字幕${r.bgm ? ` · BGM「${r.bgm}」` : ""}，进入待审核`);
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

/* 思考过程播报（驱动对话区的思考小面板） */
export function think(step) { emit("agent:think", step); }
const INTENT_LABEL = { plan_batch: "拆解量产计划", create_accounts: "批量建号", run_generation: "派发生成任务", approve_all: "批量过审", deliver_all: "批量交付", retry_failed: "重试失败项", status_query: "汇总当前进度", chat: "查阅数据后回答" };

export async function handleUserText(text) {
  const session = ensureSession();
  addMsg(session, { role: "user", type: "text", payload: { text } });
  emit("agent:thinking", true);
  think("读取工作台上下文…");
  try {
    const r = await routeIntent(text, contextSummary());
    think(`识别意图 · ${INTENT_LABEL[r.intent] || r.intent}`);
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
      agentSay(n ? `已交付 ${n} 条内容：定稿入发布清单，供应商端可见可下载。` : "没有可交付的内容（需要先通过审核）。");
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
      think("按标签 / 分组匹配账号矩阵…");
      const matched = matchAccounts(params);
      think(`命中 ${matched.length} 个账号 · 生成计划卡`);
      const wantsRandom = /随机主题|各自主题|主题随机/.test(text) || !params.topic;
      addMsg(session, {
        role: "agent", type: "plan",
        payload: {
          status: "pending", goal: text,
          topicMode: wantsRandom ? "random" : "fixed",
          topic: params.topic || "", style: params.style || "", tags: params.tags || [], group: params.group || "all",
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
    return n ? `当前没有进行中的批次，但有 ${n} 条在制任务散落在单号创作。一句话告诉我主题，我可以发起一批新的量产。` : "一切就绪。说出主题（可带标签/范围/风格），例如：「给所有职场效率账号做一期下班前自动生成日报，偏教程风」。";
  }
  return bs.map(b => {
    const prods = batchProds(b);
    const phase = { drafting: "批量起草中", awaiting_input: "等待分镜回传", generating: "渲染中", review: "待审核", done: "已完成" }[b.phase] || b.phase;
    const fail = prods.filter(p => p.stageStatus === "failed").length;
    const done = prods.filter(p => p.stage === "delivered").length;
    return `「${b.topic}」：${phase} · ${done}/${prods.length} 已交付${fail ? ` · ${fail} 条失败（说"重试失败的"即可）` : ""}`;
  }).join("\n");
}
