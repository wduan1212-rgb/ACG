/* 基础工具：DOM / 文本 / 文件 / 压缩 / 并发 */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const GRADS = [
  "linear-gradient(135deg,#3D5BFF,#22B8CF)",
  "linear-gradient(135deg,#7A4DFF,#3D5BFF)",
  "linear-gradient(135deg,#F08C00,#E8590C)",
  "linear-gradient(135deg,#0CA678,#22B8CF)",
  "linear-gradient(135deg,#E64980,#7A4DFF)",
  "linear-gradient(135deg,#1C7ED6,#4263EB)"
];
export const gradFor = (str) => GRADS[[...String(str || "x")].reduce((a, c) => a + c.charCodeAt(0), 0) % GRADS.length];

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* 限并发任务池 */
export async function runPool(items, worker, conc = 2) {
  let i = 0;
  const lane = async () => { while (i < items.length) { const it = items[i++]; await worker(it); } };
  await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, items.length)) }, lane));
}

export const delay = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- 时间 ---------- */
export function todayStamp() {
  const d = new Date(); const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
export function timeAgo(ts) {
  if (!ts) return "";
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  if (s < 86400 * 7) return Math.floor(s / 86400) + " 天前";
  const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`;
}
export const fmtTC = s => { const p = n => String(Math.floor(Math.max(0, n))).padStart(2, "0"); return `${p(s / 60)}:${p(s % 60)}`; };

/* ---------- 文本清洗（移植自 v4） ---------- */
export function stripEmoji(str) {
  return String(str || "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu, "").replace(/[ \t]{2,}/g, " ");
}
export function sanitizeProduct(str) {
  let s = String(str || "");
  s = s.replace(/百度搭子/g, "@@DMZ@@").replace(/Dumate/gi, "@@DMP@@");
  s = s.replace(/(微信|抖音|快手|淘宝|支付宝|百度)\s*(App|APP|app|应用|网盘|智能云|文库|地图|输入法)?\s*(logo|Logo|图标|标志)/g, "产品 logo");
  s = s.replace(/(微信|抖音|快手|淘宝|支付宝|百度)\s*(App|APP|app|应用|主页|首页|界面)/g, "产品界面");
  s = s.replace(/百度\s*(App|APP|app|应用|网盘|智能云|文库|地图|输入法)/g, "产品");
  s = s.replace(/@@DMZ@@/g, "百度搭子").replace(/@@DMP@@/g, "Dumate");
  return s;
}
export const cleanText = s => sanitizeProduct(stripEmoji(s));

export function parseJSONLoose(str) {
  let s = String(str).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

/* ---------- 剪贴板 / 下载 ---------- */
export function copyText(str, doneMsg) {
  const done = () => window.__toast && window.__toast(doneMsg || "已复制到剪贴板");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str).then(done).catch(() => fallbackCopy(str, done));
  } else fallbackCopy(str, done);
}
function fallbackCopy(str, done) {
  const ta = document.createElement("textarea");
  ta.value = str; ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { /* 忽略 */ }
  ta.remove();
}
export function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- 文件读取 ---------- */
export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
export function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/png";
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}
export const extOfMime = m => /png/.test(m) ? "png" : /jpe?g/.test(m) ? "jpg" : /webp/.test(m) ? "webp" : /gif/.test(m) ? "gif" : /mp4/.test(m) ? "mp4" : /webm/.test(m) ? "webm" : /audio/.test(m) ? "mp3" : "bin";

/* ---------- zip（store 模式，移植自 v4） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
export function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
export function buildZipBlob(entries) { // entries: [{name, u8}]
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  entries.forEach(e => {
    const nm = enc.encode(e.name), crc = crc32(e.u8), sz = e.u8.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
    lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, e.u8);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + sz;
  });
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
export async function blobToU8(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/* ---------- SRT ---------- */
const srtFmt = sec => { const p = n => String(n).padStart(2, "0"); const ms = String(Math.round((sec % 1) * 1000)).padStart(3, "0"); return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec % 3600 / 60))}:${p(Math.floor(sec % 60))},${ms}`; };
export function buildSRT(subs) {
  const list = (subs || []).filter(x => (x.text || "").trim());
  if (!list.length) return "";
  return list.map((x, i) => `${i + 1}\n${srtFmt(x.start || 0)} --> ${srtFmt(x.end || 0)}\n${x.text.trim()}\n`).join("\n");
}

/* ---------- 通用拖拽热区 ---------- */
export function wireDropZone(zone, handler, opts = {}) {
  if (!zone) return;
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => {
    if (opts.filesOnly && !(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"))) return;
    e.preventDefault(); e.stopPropagation(); zone.classList.add("drag-over");
  }));
  ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    if (ev === "dragleave" && zone.contains(e.relatedTarget)) return;
    zone.classList.remove("drag-over");
  }));
  zone.addEventListener("drop", e => { if (e.dataTransfer.files.length) handler(e.dataTransfer.files, e); });
}
