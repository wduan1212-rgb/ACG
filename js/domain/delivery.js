/* 发布清单：定稿入库（创作端） + 素材分发（供应商端）
   交付 = 内部定稿归档，产物进入交付库供供应商下载，不涉及任何平台发布 */

import { state, save, notify, accountById, assetById, canDeliver, currentMember } from "../core/store.js";
import { uid, esc, buildZipBlob, downloadBlob } from "../core/util.js";
import { buildDeliveryName, modeLabel } from "./accounts.js";
import { setStage, touch } from "./productions.js";
import { assetU8, urlFor } from "./assets.js";

/* 发布交付：创作者自行定稿入库（无强制审核门槛），分配全局发布序号 + 记录发布账号/成员
   交付 = 内部定稿归档，产物进入交付库供供应商下载，不涉及任何平台发布 */
export function deliver(p, opts = {}) {
  const acc = accountById(p.accountId);
  if (!acc) return null;
  if (!canDeliver()) { window.__toast && window.__toast("当前账号没有发布权限"); return null; }
  p.review.state = "approved";   // 创作者点击发布即定稿
  acc.exportSeq = (acc.exportSeq || 0) + 1;
  const name = buildDeliveryName(acc, acc.exportSeq);
  const isImg = p.mode === "图文";
  const imgItems = (p.artifacts.images.items || []).filter(x => x.assetId);
  const withSub = (p.artifacts.subs || []).some(s => (s.text || "").trim());
  const mem = currentMember();
  const pubSeq = (state.ui.deliverSeq = (state.ui.deliverSeq || 0) + 1);

  const asset = {
    id: uid(), accountId: acc.id, name,
    type: isImg ? "图集" : "视频",
    tags: ["成片", acc.mode, acc.platform, ...(isImg ? [`${imgItems.length}张组图`] : withSub ? ["带字幕"] : [])],
    createdAt: Date.now(), delivered: true, status: "未下载",
    title: p.artifacts.copy.title || p.title, copy: p.artifacts.copy.body || "",
    productionId: p.id,
    packAssetIds: isImg ? imgItems.map(x => x.assetId) : [],
    clips: isImg ? 0 : (p.artifacts.timeline || []).length,
    subCount: (p.artifacts.subs || []).filter(s => (s.text || "").trim()).length,
    pubSeq, deliveredAt: Date.now(),
    byAccount: acc.name,                          // 发布所属内容账号
    byMemberId: mem?.id || p.ownerId || null,
    byMemberName: mem?.name || "",                // 谁点的发布
    planDate: opts.planDate || "",                // 计划发布日期（可选）
    publishNote: opts.note || "",                 // 简短备注（可选）
    adminReviewed: false                          // 管理员「已审阅」标注（非强制门槛）
  };
  state.assets.push(asset);
  acc.monthlyDone = (acc.monthlyDone || 0) + 1;
  p.delivery = { assetId: asset.id, name, at: Date.now(), pubSeq, planDate: asset.planDate, note: asset.publishNote };
  p.review.at = Date.now();
  touch(p);
  setStage(p, "delivered", "done");
  save("assets", "accounts", "productions", "meta");
  notify("delivery", `「${asset.title || name}」已发布`, `#${String(pubSeq).padStart(3, "0")} · ${name}${isImg ? ".zip" : ".mp4"} · 供应商端可见`);
  return asset;
}

/* 管理员在发布清单标注/取消「已审阅」（仅记号，不阻断任何流程） */
export function toggleAdminReviewed(asset) {
  asset.adminReviewed = !asset.adminReviewed;
  asset.reviewedBy = asset.adminReviewed ? (currentMember()?.name || "管理员") : "";
  asset.reviewedAt = asset.adminReviewed ? Date.now() : null;
  save("assets");
  return asset.adminReviewed;
}

export function deliveredAssets() {
  const out = [];
  state.assets.forEach(x => {
    if (!x.delivered) return;
    const acc = accountById(x.accountId);
    if (acc) out.push({ asset: x, acc });
  });
  // 按发布序号（点击发布的先后）排序，最新在前
  return out.sort((a, b) => (b.asset.pubSeq || b.asset.createdAt || 0) - (a.asset.pubSeq || a.asset.createdAt || 0));
}

/* 下载交付物：图集打 zip（图 + 文案.txt）；视频暂为说明文档（待真实渲染接入） */
export async function downloadDelivery(asset) {
  const enc = new TextEncoder();
  if (asset.type === "图集" && (asset.packAssetIds || []).length) {
    const entries = [];
    for (let i = 0; i < asset.packAssetIds.length; i++) {
      const d = await assetU8(asset.packAssetIds[i]);
      if (d) entries.push({ name: `${asset.name}_${String(i + 1).padStart(2, "0")}.${d.ext}`, u8: d.u8 });
    }
    entries.push({ name: `${asset.name}_文案.txt`, u8: enc.encode(`标题：${asset.title || ""}\n\n${asset.copy || ""}`) });
    downloadBlob(`${asset.name}.zip`, buildZipBlob(entries));
  } else {
    // 视频成片：渲染 API 未接入，先交付内容包说明（标题/文案/构成）
    const manifest = [
      `【${asset.name}】内容交付单`,
      `标题：${asset.title || ""}`,
      `构成：${asset.clips || 0} 段成片拼接${asset.subCount ? ` · ${asset.subCount} 条字幕` : ""}`,
      ``, `--- 发布文案 ---`, asset.copy || "", ``,
      `（视频渲染 API 接入后，此处将是 ${asset.name}.mp4 成片文件）`
    ].join("\n");
    downloadBlob(`${asset.name}_交付单.txt`, new Blob([manifest], { type: "text/plain" }));
  }
  asset.status = "已下载";
  save("assets");
}

export async function batchDownload(assets) {
  let n = 0;
  for (const a of assets) { await downloadDelivery(a); n++; }
  return n;
}

/* 单个普通资产下载 */
export async function downloadAsset(a) {
  if (a.delivered) return downloadDelivery(a);
  const d = await assetU8(a.id);
  if (d) { downloadBlob(`${a.name}.${d.ext}`, new Blob([d.u8])); return; }
  const u = urlFor(a);
  if (u && u.startsWith("data:")) {
    const link = document.createElement("a");
    link.href = u; link.download = a.name; link.click();
  } else {
    window.__toast && window.__toast("该素材是占位示例，没有可下载的文件");
  }
}
