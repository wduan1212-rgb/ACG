/* 交付中心：创作端全景（含明细）+ 供应商视角（表格 / 勾选 / 批量下载）
   供应商身份登录时只渲染供应商视角 */

import { $, $$, esc, gradFor, timeAgo } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, accountById, productionById } from "../core/store.js";
import { platChip, modeLabel, PLATFORM_CODE } from "../domain/accounts.js";
import { deliveredAssets, downloadDelivery, batchDownload } from "../domain/delivery.js";
import { urlFor } from "../domain/assets.js";
import { openProductionDrawer } from "./prodDrawer.js";
import { emptyState, toast, openLightbox } from "../ui/components.js";
import { copyText } from "../core/util.js";

let tab = "creator"; // creator | supplier
let supFilter = "all";

export const deliveryView = {
  render(root) {
    const isSupplierRole = state.role === "supplier";
    if (isSupplierRole) tab = "supplier";

    const draw = () => {
      const all = deliveredAssets();
      root.innerHTML = `
        <div class="delivery-page">
          <div class="page-head">
            <div><div class="eyebrow">交付中心</div>
            <h2>${isSupplierRole ? "素材库 · 按标签筛选，勾选批量下载" : "定稿内容统一归档，供应商按需领取"}</h2></div>
            ${isSupplierRole ? `<button class="btn primary" id="dvBatchDl">${icon("download", 14)} 批量下载所选</button>` : ""}
          </div>
          ${isSupplierRole ? "" : `
          <div class="mode-tabs slim" data-active="${tab}">
            <button class="mode-tab ${tab === "creator" ? "is-active" : ""}" data-dtab="creator">创作端视角<span>交付明细 · 全链路回看</span></button>
            <button class="mode-tab ${tab === "supplier" ? "is-active" : ""}" data-dtab="supplier">供应商视角<span>他们看到的素材库</span></button>
          </div>`}
          <div id="dvBody"></div>
        </div>`;

      $$("[data-dtab]", root).forEach(b => b.addEventListener("click", () => { tab = b.dataset.dtab; draw(); }));
      const body = $("#dvBody", root);
      if (tab === "creator") drawCreator(body, all);
      else drawSupplier(body, all);
      const bd = $("#dvBatchDl", root);
      if (bd) bd.addEventListener("click", batchDl);
    };

    function drawCreator(body, all) {
      if (!all.length) { body.innerHTML = emptyState("package", "还没有交付记录", "链路走到「审核通过 → 交付入库」后会按时间汇总在这里"); return; }
      body.innerHTML = `<div class="dv-flow">${all.map(({ asset, acc }, i) => {
        const isImg = asset.type === "图集";
        const coverId = isImg ? (asset.packAssetIds || [])[0] : null;
        const u = coverId ? urlFor(coverId) : null;
        return `<div class="dv-item" style="--d:${i * 40}ms">
          <span class="dv-node${i === 0 ? " latest" : ""}"></span>
          <div class="dv-card card">
            <div class="dv-head" data-dvtoggle>
              <span class="dv-cover">${u ? `<img src="${u}"/>` : `<i style="background:${gradFor(asset.name)}">${isImg ? "图" : "▶"}</i>`}<em>${isImg ? `${(asset.packAssetIds || []).length} 张` : `${asset.clips || 0} 段`}</em></span>
              <span class="dv-main">
                <b>${esc(asset.title || asset.name)}</b>
                <span class="dv-meta">${platChip(acc.platform, true)}<em>${esc(acc.name)} · ${esc(asset.name)}${isImg ? ".zip" : ".mp4"} · ${timeAgo(asset.createdAt)} · 供应商：${asset.status || "未下载"}</em></span>
              </span>
              <span class="dv-chev">${icon("chevronDown", 14)}</span>
            </div>
            <div class="dv-detail" hidden>
              ${asset.copy ? `<pre class="dv-copy">${esc(asset.copy)}</pre>` : ""}
              ${isImg && (asset.packAssetIds || []).length ? `<div class="cc-grid">${asset.packAssetIds.map((id, k) => { const uu = urlFor(id); return uu ? `<div class="cc-thumb"><img src="${uu}" data-dvimg/><span>${k + 1}</span></div>` : ""; }).join("")}</div>` : ""}
              <div class="dv-actions">
                <button class="btn ghost sm" data-dvact="copy">${icon("copy", 13)} 复制标题+文案</button>
                <button class="btn ghost sm" data-dvact="download">${icon("download", 13)} 下载${isImg ? " zip" : "交付单"}</button>
                ${asset.productionId ? `<button class="btn ghost sm" data-dvact="prod">${icon("eye", 13)} 全链路回看</button>` : ""}
              </div>
            </div>
          </div>
        </div>`;
      }).join("")}</div>`;

      $$(".dv-head", body).forEach(h => h.addEventListener("click", () => {
        const d = h.parentElement.querySelector(".dv-detail");
        d.hidden = !d.hidden;
        h.parentElement.classList.toggle("open", !d.hidden);
      }));
      $$("[data-dvimg]", body).forEach(im => im.addEventListener("click", e => { e.stopPropagation(); openLightbox(im, im.src, ""); }));
      $$(".dv-card", body).forEach((card, idx) => {
        const { asset } = all[idx];
        card.querySelectorAll("[data-dvact]").forEach(b => b.addEventListener("click", async e => {
          e.stopPropagation();
          const act = b.dataset.dvact;
          if (act === "copy") copyText((asset.title || "") + "\n\n" + (asset.copy || ""), "已复制标题+文案");
          if (act === "download") { await downloadDelivery(asset); toast("已下载 " + asset.name); draw(); }
          if (act === "prod" && asset.productionId && productionById(asset.productionId)) openProductionDrawer(asset.productionId);
        }));
      });
    }

    function drawSupplier(body, all) {
      const platforms = [...new Set(all.map(x => x.acc.platform))];
      const tags = [...new Set(all.flatMap(x => x.asset.tags || []))];
      const filters = ["all", ...platforms, "视频", "图文", ...tags.filter(t => !["视频", "图文", ...platforms].includes(t))];
      const rows = all.filter(x => supFilter === "all" || x.acc.mode === supFilter || x.acc.platform === supFilter || (x.asset.tags || []).includes(supFilter));
      body.innerHTML = `
        <div class="fb-row" style="margin-bottom:12px">${filters.map(f => {
          const isPlat = PLATFORM_CODE[f];
          return `<button class="chip ${isPlat ? "plat" : ""} ${supFilter === f ? "on" : ""}" data-supf="${esc(f)}">${f === "all" ? "全部" : esc(f)}</button>`;
        }).join("")}</div>
        <div class="sup-table-wrap card">
          <table class="sup-table">
            <thead><tr>
              <th class="c-check"><input type="checkbox" id="supAll" /></th>
              <th>素材名</th><th>账号</th><th>平台</th><th>形式</th><th>标签</th><th>状态</th><th></th>
            </tr></thead>
            <tbody>${rows.length ? rows.map(({ asset, acc }) => `
              <tr data-sup="${asset.id}">
                <td class="c-check"><input type="checkbox" class="sup-check" /></td>
                <td class="sup-name"><b>${esc(asset.name)}</b>${asset.title ? `<em>${esc(asset.title)}</em>` : ""}</td>
                <td>${esc(acc.name)}</td>
                <td>${platChip(acc.platform, true)}</td>
                <td>${modeLabel(acc)}</td>
                <td><div class="sup-tags">${(asset.tags || []).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div></td>
                <td><span class="sup-status ${asset.status === "已下载" ? "done" : ""}">${asset.status || "未下载"}</span></td>
                <td><button class="btn ghost sm" data-supdl="${asset.id}">${icon("download", 13)} 下载</button></td>
              </tr>`).join("") : `<tr><td colspan="8" class="sup-empty">暂无成片素材。创作端交付后会按命名 + 标签自动进入这里。</td></tr>`}
            </tbody>
          </table>
        </div>`;
      $$("[data-supf]", body).forEach(b => b.addEventListener("click", () => { supFilter = b.dataset.supf; draw(); }));
      const supAll = $("#supAll", body);
      if (supAll) supAll.addEventListener("change", e => $$(".sup-check", body).forEach(c => c.checked = e.target.checked));
      $$("[data-supdl]", body).forEach(b => b.addEventListener("click", async () => {
        const a = state.assets.find(x => x.id === b.dataset.supdl);
        if (a) { await downloadDelivery(a); toast("已下载 " + a.name); draw(); }
      }));
    }

    async function batchDl() {
      const ids = $$("tr[data-sup]", root).filter(tr => tr.querySelector(".sup-check")?.checked).map(tr => tr.dataset.sup);
      if (!ids.length) { toast("先勾选要下载的素材"); return; }
      const assets = ids.map(id => state.assets.find(x => x.id === id)).filter(Boolean);
      const n = await batchDownload(assets);
      toast(`已下载 ${n} 个素材，状态更新为已下载`);
      draw();
    }

    draw();
  }
};
