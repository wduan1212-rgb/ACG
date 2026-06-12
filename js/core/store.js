/* 中央状态：单一数据源 + 事件总线 + 分集合持久化 */

import { db } from "./db.js";
import { debounce, uid } from "./util.js";

export const state = {
  role: null,                 // "studio" | "supplier" | null
  accounts: [],
  productions: [],
  assets: [],
  sessions: [],
  batches: [],
  jobs: [],
  notifications: [],
  apiKeys: [],                // 存于 meta
  ui: {
    activeAccountId: null,
    activeProductionId: null,
    activeSessionId: null,
    autoAdvance: true,
    collapsedGroups: []
  }
};

const listeners = {};
export function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => off(evt, fn); }
export function off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter(f => f !== fn); }
export function emit(evt, payload) { (listeners[evt] || []).forEach(f => { try { f(payload); } catch (e) { console.error("[store]", evt, e); } }); }

/* ---- 持久化：标脏集合，防抖落盘 ---- */
const dirty = new Set();
const persist = debounce(async () => {
  const list = [...dirty]; dirty.clear();
  for (const c of list) {
    try {
      if (c === "meta") {
        await db.metaSet("apiKeys", JSON.parse(JSON.stringify(state.apiKeys)));
        await db.metaSet("ui", JSON.parse(JSON.stringify(state.ui)));
        await db.metaSet("role", state.role);
      } else {
        await db.replaceAll(c, JSON.parse(JSON.stringify(state[c] || [])));
      }
    } catch (e) { console.warn("持久化失败", c, e); }
  }
}, 600);

export function save(...collections) {
  (collections.length ? collections : ["meta"]).forEach(c => dirty.add(c));
  persist();
  emit("change", { collections });
}

export async function persistNow() {
  db.collections.forEach(c => dirty.add(c)); dirty.add("meta");
  const list = [...dirty]; dirty.clear();
  for (const c of list) {
    try {
      if (c === "meta") {
        await db.metaSet("apiKeys", JSON.parse(JSON.stringify(state.apiKeys)));
        await db.metaSet("ui", JSON.parse(JSON.stringify(state.ui)));
        await db.metaSet("role", state.role);
      } else {
        await db.replaceAll(c, JSON.parse(JSON.stringify(state[c] || [])));
      }
    } catch (e) { /* 静默 */ }
  }
}

/* ---- 启动装载 ---- */
export async function loadAll() {
  for (const c of db.collections) state[c] = await db.getAll(c);
  state.apiKeys = (await db.metaGet("apiKeys")) || [];
  const ui = await db.metaGet("ui");
  if (ui) Object.assign(state.ui, ui);
  state.role = (await db.metaGet("role")) || null;
  // 排序约定
  state.notifications.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  state.sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* ---- 通知中心 ---- */
export function notify(kind, title, body = "", meta = {}) {
  state.notifications.unshift({ id: uid(), ts: Date.now(), kind, title, body, read: false, ...meta });
  if (state.notifications.length > 60) state.notifications.length = 60;
  save("notifications");
  emit("notify");
}

/* ---- 快捷取值 ---- */
export const accountById = id => state.accounts.find(a => a.id === id);
export const productionById = id => state.productions.find(p => p.id === id);
export const assetById = id => state.assets.find(a => a.id === id);
export const activeAccount = () => accountById(state.ui.activeAccountId) || state.accounts[0] || null;
export const activeProduction = () => productionById(state.ui.activeProductionId) || null;
