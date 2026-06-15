/* 中央状态：单一数据源 + 事件总线 + 分集合持久化 */

import { db } from "./db.js";
import { debounce, uid } from "./util.js";

export const state = {
  role: null,                 // 当前登录成员的角色："admin" | "editor" | "supplier" | null
  members: [],                // 成员账号（将来服务器侧用户表的本地形态）
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
    currentMemberId: null,    // 当前登录成员
    autoAdvance: true,
    collapsedGroups: [],
    assetSeq: 0               // 全局上传素材编号计数器（按上传先后递增）
  }
};

/* 权限：
   admin    管账号/成员/设置 + 全部创作与审核
   reviewer 审核员：可创作，且可审核（通过并交付入供应商端 / 驳回）
   editor   创作成员：只走创作流程，只能"提交审核"，不能入供应商端
   supplier 只进发布清单 */
export const ROLE_LABEL = { admin: "管理员", reviewer: "审核员", editor: "创作成员", supplier: "供应商" };
export const currentMember = () => state.members.find(m => m.id === state.ui.currentMemberId) || null;
export const myId = () => state.ui.currentMemberId;
export const canManageAccounts = () => state.role === "admin";
export const canManageMembers = () => state.role === "admin";
export const canCreate = () => state.role === "admin" || state.role === "reviewer" || state.role === "editor";
export const canReview = () => state.role === "admin" || state.role === "reviewer";   // 审核 + 入供应商端
/* 创作互不干扰：editor 只看自己；admin/reviewer 监管全看（需跨人审核）。旧数据无 owner 视为可见 */
export const ownedBy = (item) => !item.ownerId || item.ownerId === state.ui.currentMemberId || canReview();

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
        await db.metaSet("members", JSON.parse(JSON.stringify(state.members)));
      } else {
        await db.replaceAll(c, JSON.parse(JSON.stringify(state[c] || [])));
      }
    } catch (e) { /* 静默 */ }
  }
}

/* ---- 启动装载 ---- */
export async function loadAll() {
  for (const c of db.collections) state[c] = await db.getAll(c);
  state.members = (await db.metaGet("members")) || [];
  state.apiKeys = (await db.metaGet("apiKeys")) || [];
  const ui = await db.metaGet("ui");
  if (ui) Object.assign(state.ui, ui);
  state.role = (await db.metaGet("role")) || null;
  if (state.role === "studio") state.role = "admin"; // 旧身份迁移
  // 种子成员（首次：一个管理员；保留旧三档作为示例成员）
  if (!state.members.length) {
    state.members = [
      { id: uid(), name: "管理员", username: "admin", pin: "admin888", role: "admin", createdAt: Date.now() },
      { id: uid(), name: "审核员", username: "reviewer", pin: "888888", role: "reviewer", createdAt: Date.now() },
      { id: uid(), name: "创作成员A", username: "editor", pin: "666666", role: "editor", createdAt: Date.now() },
      { id: uid(), name: "供应商", username: "supplier", pin: "222222", role: "supplier", createdAt: Date.now() }
    ];
    db.metaSet("members", JSON.parse(JSON.stringify(state.members)));
  }
  if (state.ui.assetSeq == null) state.ui.assetSeq = state.assets.filter(a => !a.delivered).length;
  // 当前成员失效时清空（要求重新登录）
  if (state.ui.currentMemberId && !state.members.find(m => m.id === state.ui.currentMemberId)) {
    state.ui.currentMemberId = null; state.role = null;
  }
  // 排序约定
  state.notifications.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  state.sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function saveMembers() {
  db.metaSet("members", JSON.parse(JSON.stringify(state.members)));
  emit("change", { collections: ["members"] });
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
