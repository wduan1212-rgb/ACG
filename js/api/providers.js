/* ProviderAdapter：视频/图片生成服务的统一接入面
   接真实 API（即梦 / Seedance / 千帆）= 新增一个实现了 submit/poll/cancel 的对象并注册，
   其余代码（JobRunner / UI）零改动。

   接口约定：
   adapter = {
     id, kind: "video"|"image", label,
     capabilities: { ratios: [], maxDuration, refImages, characterLock },
     async submit(req)  -> { providerRef }            // req: {prompt, refs:[{name,blob|url}], ratio, duration}
     async poll(ref)    -> { status: "running"|"succeeded"|"failed", progress: 0-100, output?, error? }
     async cancel(ref)  -> void
   } */

import { state } from "../core/store.js";

const registry = new Map();
export function registerProvider(adapter) { registry.set(adapter.id, adapter); }
export function getProvider(id) { return registry.get(id) || null; }

/* 当前生效的 provider：配置了真实 Key 则优先（未来在此路由），否则 mock */
export function activeProviderFor(kind) {
  const k = state.apiKeys.find(x => x.type === (kind === "video" ? "video" : "image") && x.secret);
  // 真实 adapter 注册后在这里按 k.provider 匹配；当前阶段统一走 mock
  if (k) {
    const real = [...registry.values()].find(a => a.kind === kind && a.id !== `mock-${kind}` && (k.provider || "").includes(a.label));
    if (real) return real;
  }
  return registry.get(`mock-${kind}`);
}

export function videoApiConfigured() {
  return state.apiKeys.some(x => x.type === "video" && x.secret);
}
export function imageApiConfigured() {
  return state.apiKeys.some(x => x.type === "image" && x.secret);
}

/* ---------- Mock 视频 Provider：模拟真实异步生成的全部状态 ---------- */
const mockRuns = new Map(); // ref -> {startedAt, duration, willFail}

function hashOf(str) {
  return [...String(str)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
}

registerProvider({
  id: "mock-video",
  kind: "video",
  label: "模拟视频引擎",
  mock: true,
  capabilities: { ratios: ["9:16", "16:9", "1:1"], maxDuration: 15, refImages: true, characterLock: true },
  async submit(req) {
    const ref = "mv_" + Math.random().toString(36).slice(2, 10);
    const h = hashOf(req.prompt || ref);
    mockRuns.set(ref, {
      startedAt: Date.now(),
      duration: 6000 + (h % 7000),               // 6-13s 模拟渲染
      willFail: (h % 100) < 8 && (req.attempt || 0) === 0  // 首次约 8% 失败率，重试必成功
    });
    return { providerRef: ref };
  },
  async poll(ref) {
    const run = mockRuns.get(ref);
    if (!run) return { status: "failed", progress: 0, error: "任务不存在（页面曾刷新），请重试" };
    const elapsed = Date.now() - run.startedAt;
    const progress = Math.min(100, Math.round(elapsed / run.duration * 100));
    if (progress >= 100) {
      mockRuns.delete(ref);
      if (run.willFail) return { status: "failed", progress: 92, error: "模拟引擎随机失败（演示重试链路）" };
      return { status: "succeeded", progress: 100, output: { kind: "mock", label: "15s 片段已生成（模拟）" } };
    }
    return { status: "running", progress };
  },
  async cancel(ref) { mockRuns.delete(ref); }
});

/* ---------- Mock 图片 Provider（图片 API 未接入期，站内生成走它） ---------- */
registerProvider({
  id: "mock-image",
  kind: "image",
  label: "模拟图片引擎",
  mock: true,
  capabilities: { ratios: ["3:4", "9:16", "1:1"], refImages: true },
  async submit(req) {
    const ref = "mi_" + Math.random().toString(36).slice(2, 10);
    mockRuns.set(ref, { startedAt: Date.now(), duration: 1500 + Math.random() * 1500, willFail: false });
    return { providerRef: ref };
  },
  async poll(ref) {
    const run = mockRuns.get(ref);
    if (!run) return { status: "failed", progress: 0, error: "任务不存在" };
    const elapsed = Date.now() - run.startedAt;
    if (elapsed >= run.duration) { mockRuns.delete(ref); return { status: "succeeded", progress: 100, output: { kind: "mock" } }; }
    return { status: "running", progress: Math.round(elapsed / run.duration * 100) };
  },
  async cancel(ref) { mockRuns.delete(ref); }
});

/* ---------- 真实 Provider 模板（接入时取消注释并填写映射） ----------
registerProvider({
  id: "jimeng-video",
  kind: "video",
  label: "即梦",
  capabilities: { ratios: ["9:16", "16:9"], maxDuration: 15, refImages: true, characterLock: true },
  async submit({ prompt, refs, ratio, duration, apiKey, endpoint }) {
    const body = {
      prompt, aspect_ratio: ratio, duration,
      reference_images: refs.map(r => r.url),      // 全部参考图
      first_frame_image: refs[0]?.url,             // 首帧
      character_image: refs.find(r => /角色|数字人/.test(r.name))?.url
    };
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey }, body: JSON.stringify(body) });
    const d = await res.json();
    return { providerRef: d.task_id };
  },
  async poll(ref) { ... 轮询 task 状态，映射到 {status, progress, output:{url}} ... },
  async cancel(ref) { ... }
});
------------------------------------------------------------------ */
