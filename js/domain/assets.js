/* 资产领域：元数据在 state.assets，二进制在 blobs 仓，运行时 objectURL 缓存 */

import { db } from "../core/db.js";
import { state, save, assetById } from "../core/store.js";
import { uid, esc, gradFor, dataUrlToBlob, extOfMime } from "../core/util.js";

const urlCache = new Map(); // assetId -> objectURL

export async function preloadBlobUrls() {
  const entries = await db.getAllBlobEntries();
  entries.forEach(({ id, blob }) => {
    if (blob instanceof Blob && !urlCache.has(id)) urlCache.set(id, URL.createObjectURL(blob));
  });
}

export function urlFor(idOrAsset) {
  const a = typeof idOrAsset === "string" ? assetById(idOrAsset) : idOrAsset;
  if (!a) return null;
  if (urlCache.has(a.id)) return urlCache.get(a.id);
  if (a.dataUrl) return a.dataUrl; // 兼容遗留小数据
  return null;
}

/* 新增资产（dataUrl 形式进来 → 转 Blob 落库） */
export async function addAssetFromDataUrl(accountId, { name, type = "图片", tags = [], dataUrl }) {
  const a = { id: uid(), accountId, name: name || "未命名素材", type, tags, createdAt: Date.now(), hasBlob: !!dataUrl };
  if (dataUrl) {
    try {
      const blob = dataUrlToBlob(dataUrl);
      await db.putBlob(a.id, blob);
      urlCache.set(a.id, URL.createObjectURL(blob));
    } catch (e) { a.dataUrl = dataUrl; a.hasBlob = false; }
  }
  state.assets.push(a);
  save("assets");
  return a;
}

export async function addAssetFromFile(accountId, file, { tags = [], name } = {}) {
  const type = file.type.startsWith("video/") ? "视频" : file.type.startsWith("audio/") ? "音频" : "图片";
  const a = { id: uid(), accountId, name: name || file.name.replace(/\.[^.]+$/, ""), type, tags, createdAt: Date.now(), hasBlob: true, mime: file.type };
  await db.putBlob(a.id, file);
  urlCache.set(a.id, URL.createObjectURL(file));
  state.assets.push(a);
  save("assets");
  return a;
}

/* 覆盖资产二进制（如重新回传同槽位） */
export async function replaceAssetBlob(assetId, dataUrl) {
  const a = assetById(assetId); if (!a) return;
  const blob = dataUrlToBlob(dataUrl);
  await db.putBlob(a.id, blob);
  const old = urlCache.get(a.id);
  if (old) URL.revokeObjectURL(old);
  urlCache.set(a.id, URL.createObjectURL(blob));
  a.hasBlob = true; delete a.dataUrl;
  save("assets");
}

export async function removeAsset(id) {
  const a = assetById(id); if (!a) return;
  state.assets = state.assets.filter(x => x.id !== id);
  await db.delBlob(id);
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
  save("assets");
}

export async function assetBlob(id) {
  return db.getBlob(id);
}

export async function assetU8(id) {
  const b = await db.getBlob(id);
  if (!b) return null;
  return { u8: new Uint8Array(await b.arrayBuffer()), ext: extOfMime(b.type || "image/png") };
}

/* 缩略 html：有图用图，无图用渐变占位 */
const TYPE_HUE = { "图片": "linear-gradient(135deg,#3D5BFF,#4b8dff)", "视频": "linear-gradient(135deg,#7A4DFF,#3D5BFF)", "音频": "linear-gradient(135deg,#0CA678,#22B8CF)", "图集": "linear-gradient(135deg,#E64980,#7A4DFF)" };
export function thumbHtml(a, cls = "") {
  const u = urlFor(a);
  if (u && a.type !== "音频") return `<img class="${cls}" src="${u}" alt="" loading="lazy"/>`;
  return `<div class="ph ${cls}" style="background:${TYPE_HUE[a.type] || gradFor(a.name)}"><span>${esc((a.type || a.name || "素")[0])}</span></div>`;
}

export function searchAssets({ accountId = "all", tag = "all", q = "", includeDelivered = false } = {}) {
  const kw = q.trim().toLowerCase();
  return state.assets.filter(a => {
    if (!includeDelivered && a.delivered) return false;
    if (accountId !== "all" && a.accountId !== accountId) return false;
    if (tag !== "all" && !(a.tags || []).includes(tag)) return false;
    if (kw && !a.name.toLowerCase().includes(kw) && !(a.tags || []).some(t => t.toLowerCase().includes(kw))) return false;
    return true;
  });
}

export function allTags(accountId = "all") {
  const set = new Set();
  state.assets.forEach(a => {
    if (a.delivered) return;
    if (accountId !== "all" && a.accountId !== accountId) return;
    (a.tags || []).forEach(t => set.add(t));
  });
  return [...set];
}
