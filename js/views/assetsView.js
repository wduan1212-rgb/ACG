/* 资产库：全账号聚合 + 账号/标签筛选 + 上传/改名/打标/删除/下载 */

import { $, $$, esc } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, accountById, activeAccount } from "../core/store.js";
import { searchAssets, allTags, thumbHtml, addAssetFromFile, removeAsset, urlFor } from "../domain/assets.js";
import { downloadAsset } from "../domain/delivery.js";
import { platChip } from "../domain/accounts.js";
import { emptyState, toast, promptModal, confirmModal, openLightbox } from "../ui/components.js";
import { wireDropZone } from "../core/util.js";

let fAcc = "all", fTag = "all", fQ = "";

export const assetsView = {
  render(root) {
    const draw = () => {
      const list = searchAssets({ accountId: fAcc, tag: fTag, q: fQ }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const tags = allTags(fAcc);
      root.innerHTML = `
        <div class="assets-page">
          <div class="page-head">
            <div><div class="eyebrow">资产库 · 全账号聚合</div>
            <h2>素材按账号隔离、按标签流转，生成时 @ 调用</h2></div>
            <label class="btn primary">${icon("upload", 14)} 上传素材<input type="file" accept="image/*,video/*,audio/*" multiple hidden id="avUpload" /></label>
          </div>
          <div class="filter-bar card">
            <div class="fb-search">${icon("search", 14)}<input id="avSearch" placeholder="搜索素材名 / 标签" value="${esc(fQ)}" /></div>
            <div class="fb-row">
              <button class="chip ${fAcc === "all" ? "on" : ""}" data-facc="all">全部账号</button>
              ${state.accounts.map(a => `<button class="chip ${fAcc === a.id ? "on" : ""}" data-facc="${a.id}">${esc(a.name)}</button>`).join("")}
            </div>
            <div class="fb-row">
              <button class="chip ${fTag === "all" ? "on" : ""}" data-ftag="all">全部标签</button>
              ${tags.map(t => `<button class="chip ${fTag === t ? "on" : ""}" data-ftag="${esc(t)}"># ${esc(t)}</button>`).join("")}
            </div>
          </div>
          <div class="asset-grid" id="avGrid">
            ${list.length ? list.map(a => {
              const acc = accountById(a.accountId);
              return `<div class="asset-card card" data-aid="${a.id}">
                <div class="ac-thumb">${thumbHtml(a)}
                  ${a.type === "视频" ? `<span class="ac-play">${icon("play", 13)}</span>` : ""}
                  <div class="ac-hover">
                    <button class="ac-mini" data-aact="download" title="下载">${icon("download", 13)}</button>
                    <button class="ac-mini" data-aact="rename" title="重命名">${icon("edit", 13)}</button>
                    <button class="ac-mini" data-aact="tag" title="加标签">#</button>
                    <button class="ac-mini danger" data-aact="del" title="删除">${icon("trash", 13)}</button>
                  </div>
                </div>
                <div class="ac-body">
                  <div class="ac-name" title="${esc(a.name)}">${esc(a.name)}</div>
                  <div class="ac-tags">${acc ? platChip(acc.platform, true) : ""}${(a.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join("") || `<span class="tag muted-tag">未打标签</span>`}</div>
                </div>
              </div>`;
            }).join("") : emptyState("folder", "没有匹配的素材", "拖拽图片到页面任意位置即可上传" + (fAcc === "all" ? "（先选一个账号）" : ""))}
          </div>
        </div>`;
      wire();
    };

    const wire = () => {
      $("#avSearch", root).addEventListener("input", e => { fQ = e.target.value; draw(); setTimeout(() => { const i = $("#avSearch", root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 0); });
      $$("[data-facc]", root).forEach(b => b.addEventListener("click", () => { fAcc = b.dataset.facc; fTag = "all"; draw(); }));
      $$("[data-ftag]", root).forEach(b => b.addEventListener("click", () => { fTag = b.dataset.ftag; draw(); }));
      $("#avUpload", root).addEventListener("change", async e => { await uploadFiles(e.target.files); });

      $$(".asset-card", root).forEach(card => {
        const a = state.assets.find(x => x.id === card.dataset.aid);
        if (!a) return;
        const img = card.querySelector(".ac-thumb img");
        if (img) img.addEventListener("click", () => openLightbox(img, urlFor(a), a.name));
        card.querySelector('[data-aact="download"]').addEventListener("click", () => downloadAsset(a));
        card.querySelector('[data-aact="rename"]').addEventListener("click", async () => {
          const name = await promptModal({ title: "重命名素材", value: a.name });
          if (name) { a.name = name; save("assets"); draw(); }
        });
        card.querySelector('[data-aact="tag"]').addEventListener("click", async () => {
          const t = await promptModal({ title: "添加标签（逗号分隔多个）", placeholder: "例如：角色版, 界面截图" });
          if (t) {
            t.split(/[,，]/).map(s => s.trim()).filter(Boolean).forEach(tag => { a.tags = a.tags || []; if (!a.tags.includes(tag)) a.tags.push(tag); });
            save("assets"); draw();
          }
        });
        card.querySelector('[data-aact="del"]').addEventListener("click", async () => {
          const ok = await confirmModal({ title: `删除素材「${a.name}」？`, danger: true, okText: "删除" });
          if (ok) { await removeAsset(a.id); draw(); }
        });
      });
    };

    async function uploadFiles(files) {
      const accId = fAcc !== "all" ? fAcc : (activeAccount()?.id);
      if (!accId) { toast("先创建一个账号"); return; }
      let n = 0;
      for (const f of Array.from(files)) { await addAssetFromFile(accId, f); n++; }
      toast(`已上传 ${n} 个素材到「${accountById(accId)?.name}」`);
      draw();
    }

    wireDropZone(root, files => uploadFiles(files), { filesOnly: true });
    draw();
  }
};
