/* production：统一内容生产任务模型 + 阶段状态机
   图文：script → images → copy → review → delivered
   视频：script → boards → prompts → render → cut → copy → review → delivered */

import { state, save, emit, accountById } from "../core/store.js";
import { uid } from "../core/util.js";

export const STAGES = {
  script: { label: "脚本", icon: "fileText" },
  boards: { label: "分镜", icon: "image" },
  images: { label: "成图", icon: "image" },
  prompts: { label: "提示词", icon: "list" },
  render: { label: "生成", icon: "film" },
  cut: { label: "剪辑", icon: "scissors" },
  copy: { label: "文案", icon: "type" },
  review: { label: "审核", icon: "eye" },
  delivered: { label: "已交付", icon: "package" }
};

export const flowOf = (mode) => mode === "图文"
  ? ["script", "images", "copy", "review"]
  : ["script", "boards", "prompts", "render", "cut", "copy", "review"];

export const STATUS_LABEL = {
  pending: "待开始", running: "进行中", needs_input: "等待回传", failed: "失败", done: "已完成"
};

export function blankArtifacts() {
  return {
    script: { title: "", shots: [], source: "", style: "", imageCount: 6, direction: "" },
    boards: { items: [], sharedRefAssetId: null, externalPrompt: "" },
    images: { items: [], sharedRefAssetId: null, externalPrompt: "" },
    prompts: [],
    renders: [],            // jobId 列表
    timeline: [],           // [{id, jobId, name, dur, trimIn}]
    subs: [],
    subStyle: { size: 13, stroke: 2, bottom: 12 },
    copy: { title: "", body: "" }
  };
}

export function createProduction({ accountId, topic = "", origin = "manual", batchId = null, style = "" }) {
  const acc = accountById(accountId);
  if (!acc) return null;
  const p = {
    id: uid(), accountId, origin, batchId,
    mode: acc.mode, subType: acc.subType || "",
    topic, title: topic, style,
    stage: "script", stageStatus: "pending",
    artifacts: blankArtifacts(),
    review: { state: "pending", notes: "", returnTo: null, at: null },
    delivery: null,
    error: null,
    createdAt: Date.now(), updatedAt: Date.now()
  };
  if (style) p.artifacts.script.style = style;
  state.productions.push(p);
  save("productions");
  return p;
}

export function touch(p) { p.updatedAt = Date.now(); }

export function setStage(p, stage, status = "pending") {
  p.stage = stage; p.stageStatus = status; touch(p);
  save("productions");
  emit("production:update", p);
}

export function setStatus(p, status, error = null) {
  p.stageStatus = status;
  p.error = status === "failed" ? (error || "未知错误") : null;
  touch(p);
  save("productions");
  emit("production:update", p);
}

/* 当前阶段完成 → 推进到下一阶段 */
export function advance(p, nextStatus = "pending") {
  const flow = flowOf(p.mode);
  const i = flow.indexOf(p.stage);
  if (i < 0 || i >= flow.length - 1) return;
  setStage(p, flow[i + 1], nextStatus);
}

export function stageIndex(p) {
  return flowOf(p.mode).indexOf(p.stage);
}

/* 阶段完成度判断（用于 stepper 已完成态与看板圆点） */
export function stageDone(p, stage) {
  const A = p.artifacts;
  switch (stage) {
    case "script": return (A.script.shots || []).length > 0;
    case "boards": { const it = A.boards.items || []; return it.length > 0 && it.every(x => x.assetId); }
    case "images": { const it = A.images.items || []; return it.length > 0 && it.every(x => x.assetId); }
    case "prompts": return (A.prompts || []).length > 0;
    case "render": { const jobs = jobsOf(p); return jobs.length > 0 && jobs.every(j => j.status === "succeeded"); }
    case "cut": return (A.timeline || []).length > 0;
    case "copy": return !!(A.copy.title && A.copy.body);
    case "review": return p.review.state === "approved";
    default: return p.stage === "delivered";
  }
}

export function jobsOf(p) {
  return state.jobs.filter(j => j.productionId === p.id && !j.superseded);
}

/* 状态徽章数据：[label, css 类] */
export function statusPill(p) {
  if (p.stage === "delivered") return ["已交付", "delivered"];
  if (p.stageStatus === "failed") return ["失败", "failed"];
  if (p.stageStatus === "running") return [STAGES[p.stage].label + "中", "running"];
  if (p.stageStatus === "needs_input") return ["等待回传", "input"];
  if (p.stage === "review") return [p.review.state === "approved" ? "审核通过" : "待审核", p.review.state === "approved" ? "approved" : "review"];
  return [STAGES[p.stage].label + " · 待处理", "pending"];
}

export function deleteProduction(id) {
  state.productions = state.productions.filter(p => p.id !== id);
  state.jobs = state.jobs.filter(j => j.productionId !== id);
  if (state.ui.activeProductionId === id) state.ui.activeProductionId = null;
  save("productions", "jobs", "meta");
}

export function productionsOf(accountId) {
  return state.productions.filter(p => p.accountId === accountId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function inFlightOf(accountId) {
  return productionsOf(accountId).filter(p => p.stage !== "delivered");
}

/* 脚本镜头序列化（给模型） */
export function shotsToText(shots, img) {
  if (!shots || !shots.length) return "";
  return shots.map((s, i) => img
    ? `图${i + 1}｜核心思想：${s.idea || ""}｜画面：${s.visual || ""}｜文案：${s.line || ""}`
    : `镜头${i + 1}｜${s.time || ""}｜核心思想：${s.idea || ""}｜画面：${s.visual || ""}｜口播：${s.line || ""}`
  ).join("\n");
}

/* 视频脚本时间归一化：覆盖 0-30s，15s 处可拆前后段 */
export function normalizeVideoTimes(shots) {
  const n = shots.length || 1;
  const half = Math.max(1, Math.ceil(n / 2));
  const back = Math.max(1, n - half);
  shots.forEach((s, i) => {
    let start, end;
    if (i < half) { start = Math.round(i * 15 / half); end = Math.round((i + 1) * 15 / half); }
    else { const k = i - half; start = 15 + Math.round(k * 15 / back); end = 15 + Math.round((k + 1) * 15 / back); }
    s.time = `${start}-${end}s`;
  });
  if (shots.length) shots[shots.length - 1].time = shots[shots.length - 1].time.replace(/-\d+s$/, "-30s");
}

/* 生成台片段视图：每场景拆 前/后 两个独立 15s 段 */
export function segmentsForGen(p) {
  const prompts = p.artifacts.prompts || [];
  if (!prompts.length) return [];
  const segs = [];
  prompts.forEach((sc, pi) => {
    const base = sc.name || `场景 ${String(pi + 1).padStart(2, "0")}`;
    segs.push({ scene: pi, part: "front", sceneName: base, name: `${base} · 第一段`, prompt: sc.front || "" });
    if (sc.back) segs.push({ scene: pi, part: "back", sceneName: base, name: `${base} · 第二段`, prompt: sc.back || "" });
  });
  return segs;
}

/* 智能剪辑：用已成功的 job 自动拼时间轴 + 从口播铺字幕 */
export function autoAssemble(p) {
  const segs = segmentsForGen(p);
  const okJobs = segs.map((s, i) => {
    const list = state.jobs.filter(j => j.productionId === p.id && j.segIndex === i && j.status === "succeeded");
    return list[list.length - 1] || null;
  }).filter(Boolean);
  if (okJobs.length) {
    p.artifacts.timeline = okJobs.map(j => ({ id: uid(), jobId: j.id, name: j.segName || `Segment ${j.segIndex + 1}`, dur: 15, trimIn: 0 }));
  }
  const rows = (p.artifacts.script.shots || []).filter(s => (s.line || "").trim());
  if (rows.length && !(p.artifacts.subs || []).length) {
    let t = 0;
    p.artifacts.subs = rows.map(s => {
      let st = t, en; const m = String(s.time || "").match(/(\d+)\s*-\s*(\d+)/);
      if (m) { st = +m[1]; en = +m[2]; } else { en = st + 3; } t = en;
      return { start: st, end: en, text: s.line.trim() };
    });
  }
  touch(p);
  save("productions");
  return { clips: p.artifacts.timeline.length, subs: (p.artifacts.subs || []).length };
}
