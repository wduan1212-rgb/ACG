/* 交付中心：定稿入库（创作端） + 素材分发（供应商端）
   交付 = 内部定稿归档，产物进入交付库供供应商下载，不涉及任何平台发布 */

import { state, save, notify, accountById, assetById } from "../core/store.js";
import { uid, esc, buildZipBlob, downloadBlob } from "../core/util.js";
import { buildDeliveryName, modeLabel } from "./accounts.js";
import { setStage, touch } from "./productions.js";
import { assetU8, urlFor } from "./assets.js";

/* 交付：生成交付资产记录，推进 production 到 delivered */
export function deliver(p) {
  const acc = accountById(p.accountId);
  if (!acc) return null;
  if (p.review.state !== "approved") return null;
  acc.exportSeq = (acc.exportSeq || 0) + 1;
  const name = buildDeliveryName(acc, acc.exportSeq);
  const isImg = p.mode === "图文";
  const imgItems = (p.artifacts.images.items || []).filter(x => x.assetId);
  const withSub = (p.artifacts.subs || []).some(s => (s.text || "").trim());

  const asset = {
    id: uid(), accountId: acc.id, name,
    type: isImg ? "图集" : "视频",
    tags: ["成片", acc.mode, acc.platform, ...(isImg ? [`${imgItems.length}张组图`] : withSub ? ["带字幕"] : [])],
    createdAt: Date.now(), delivered: true, status: "未下载",
    title: p.artifacts.copy.title || p.title, copy: p.artifacts.copy.body || "",
    productionId: p.id,
    packAssetIds: isImg ? imgItems.map(x => x.assetId) : [],
    clips: isImg ? 0 : (p.artifacts.timeline || []).length,
    subCount: (p.artifacts.subs || []).filter(s => (s.text || "").trim()).length
  };
  state.assets.push(asset);
  acc.monthlyDone = (acc.monthlyDone || 0) + 1;
  p.delivery = { assetId: asset.id, name, at: Date.now() };
  p.review.at = Date.now();
  touch(p);
  setStage(p, "delivered", "done");
  save("assets", "accounts", "productions");
  notify("delivery", `「${asset.title || name}」已交付入库`, `${name}${isImg ? ".zip" : ".mp4"} · 供应商端可见`);
  return asset;
}

export function deliveredAssets() {
  const out = [];
  state.assets.forEach(x => {
    if (!x.delivered) return;
    const acc = accountById(x.accountId);
    if (acc) out.push({ asset: x, acc });
  });
  return out.sort((a, b) => (b.asset.createdAt || 0) - (a.asset.createdAt || 0));
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
