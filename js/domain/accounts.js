/* 账号领域：分组 / 标签 / 命名规则 / 增删改 */

import { state, save, notify } from "../core/store.js";
import { uid, todayStamp, esc } from "../core/util.js";

export const TAG_POOL = ["产品功能", "家庭管理", "职场效率", "创作者", "岗位垂类", "测评中立", "学生教培"];
export const PLATFORM_CODE = { "小红书": "XHS", "视频号": "SPH", "抖音": "DY", "公众号": "GZH" };
export const platformCode = p => PLATFORM_CODE[p] || "XHS";

export const groupOf = a => a.mode === "图文" ? "图文组" : (a.subType === "数字人" ? "真人" : "素材");
export const tagsOf = a => (a.qtags && a.qtags.length) ? a.qtags
  : TAG_POOL.filter(t => ((a.position || "") + (a.name || "")).includes(t.slice(0, 2)));
export const modeLabel = a => a.mode === "视频" ? (a.subType || "视频") : "图文";

export function platChip(p, sm = false) {
  return `<span class="plat-chip ${platformCode(p).toLowerCase()}${sm ? " sm" : ""}">${esc(p)}</span>`;
}

/* 月度产量小条：刻度全账号统一，取整十 */
export function monthlyBarHtml(a, withText = false) {
  const done = a.monthlyDone || 0;
  const peak = Math.max(...state.accounts.map(x => x.monthlyDone || 0), 0);
  const scale = Math.max(20, Math.ceil((peak + 1) / 10) * 10);
  const pct = Math.min(100, Math.round(done / scale * 100));
  return `<span class="month-progress" title="本月已交付 ${done} 条（刻度 ${scale}）">
    <span class="mp-track"><i style="width:${pct}%"></i></span><em>${withText ? `本月 ${done} 条` : done}</em>
  </span>`;
}

/* 交付命名：平台码-账号名-内容形式-序号-日期 */
export function buildDeliveryName(acc, seq) {
  const nm = (acc.name || "账号").replace(/\s+/g, "");
  return `${platformCode(acc.platform)}-${nm}-${modeLabel(acc)}-${String(seq).padStart(3, "0")}-${todayStamp()}`;
}

export function createAccount(data) {
  const a = {
    id: uid(),
    name: data.name,
    platform: ["小红书", "视频号", "抖音", "公众号"].includes(data.platform) ? data.platform : "小红书",
    mode: data.mode === "图文" ? "图文" : "视频",
    subType: data.mode === "图文" ? "" : (data.subType === "无数字人" ? "无数字人" : "数字人"),
    position: data.position || "（待补充定位）",
    tone: data.tone || "教程感",
    qtags: (data.qtags || []).filter(t => TAG_POOL.includes(t)),
    monthlyDone: 0, exportSeq: 0,
    charBoardAssetId: data.charBoardAssetId || null,
    lockedStyle: null, customStyleChips: [],
    createdAt: Date.now()
  };
  state.accounts.push(a);
  save("accounts");
  return a;
}

export function updateAccount(id, patch) {
  const a = state.accounts.find(x => x.id === id);
  if (!a) return null;
  Object.assign(a, patch);
  save("accounts");
  return a;
}

export function deleteAccount(id) {
  const a = state.accounts.find(x => x.id === id);
  if (!a) return false;
  state.accounts = state.accounts.filter(x => x.id !== id);
  state.productions = state.productions.filter(p => p.accountId !== id);
  state.assets = state.assets.filter(x => x.accountId !== id);
  if (state.ui.activeAccountId === id) state.ui.activeAccountId = state.accounts[0]?.id || null;
  save("accounts", "productions", "assets", "meta");
  notify("account", `账号「${a.name}」已删除`, "其任务与资产已一并移除");
  return true;
}

export function accountAssets(accId) {
  return state.assets.filter(x => x.accountId === accId && !x.delivered);
}

export const charBoardOf = a => a && a.charBoardAssetId ? state.assets.find(x => x.id === a.charBoardAssetId) : null;
